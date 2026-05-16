/**
 * @orboto/mail-mcp — MCP server for the Orboto Mail Service (OMS-11).
 *
 * Exposes seven tools to AI agents (Claude Code, Cursor, MCP-aware
 * bots). The agent calls a tool; this server proxies it to the OMS
 * REST API at `OMS_BASE_URL` (default https://mail.orboto.io/api)
 * using `OMS_API_KEY` as the Bearer token. Every tool response
 * includes `remainingQuota` so the agent can decide whether to retry,
 * back off, or escalate to the human.
 *
 * Tools registered:
 *   - oms_send_email
 *   - oms_send_template
 *   - oms_get_quota
 *   - oms_list_recent_sends
 *   - oms_check_suppression
 *   - oms_add_to_suppression
 *   - oms_list_templates
 *
 * Boot via `bin: orboto-mail-mcp` (cli.ts).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface CreateServerOptions {
  /** OMS API base URL — default `https://mail.orboto.io/api`. */
  baseUrl?: string;
  /** Bearer-token (`oms_live_…` or `oms_test_…`). Required. */
  apiKey: string;
  /** Test injection — substitute global fetch for unit tests. */
  fetchImpl?: typeof fetch;
}

interface HttpJsonResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Build the MCP server. Exposed as a function (not module-level state)
 * so the caller (cli.ts or tests) controls when the server actually
 * starts listening + which transport it uses.
 */
export function createServer(opts: CreateServerOptions): McpServer {
  const baseUrl = (opts.baseUrl ?? 'https://mail.orboto.io/api').replace(/\/$/, '');
  const apiKey = opts.apiKey;
  const fetchImpl = opts.fetchImpl ?? fetch;

  if (!apiKey) {
    throw new Error(
      '@orboto/mail-mcp: apiKey is required. Set OMS_API_KEY in your environment or pass it to createServer().',
    );
  }

  async function omsFetch(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<HttpJsonResult> {
    const url = `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(url, init);
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }

  /**
   * Format an OMS response as an MCP `CallToolResult`. Errors are
   * marked with `isError: true` so the agent surfaces them — and the
   * raw body (including `remainingQuota` on 402, `reason` codes, etc.)
   * is rendered as JSON in the text content for the agent to parse.
   */
  function asResult(r: HttpJsonResult) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(r.body, null, 2),
        },
      ],
      isError: !r.ok,
    };
  }

  const server = new McpServer({
    name: '@orboto/mail-mcp',
    version: '0.2.0',
  });

  // ── oms_send_email ──────────────────────────────────────────────
  server.tool(
    'oms_send_email',
    'Send a transactional email through OMS. Use this for one-off mails ' +
      'where the agent supplies the full subject + body. For templated ' +
      'sends, use `oms_send_template` instead. Returns the messageId, ' +
      'queued status, overage flag, and remainingQuota — read remainingQuota ' +
      'to decide whether the next send needs user confirmation.',
    {
      from: z.string().email().describe('Sender address (must be on an authorized domain).'),
      to: z.string().email().describe('Recipient address.'),
      subject: z.string().min(1).describe('Subject line.'),
      body_html: z
        .string()
        .optional()
        .describe('HTML body. At least one of body_html or body_text is required.'),
      body_text: z.string().optional().describe('Plain-text body.'),
      tags: z
        .record(z.string())
        .optional()
        .describe('Tag bag, e.g. { workflow: "invite", tenant_id: "acme" }.'),
    },
    async (args) => {
      const r = await omsFetch('POST', '/v1/send', {
        from: args.from,
        to: args.to,
        subject: args.subject,
        html: args.body_html,
        text: args.body_text,
        tags: args.tags,
      });
      return asResult(r);
    },
  );

  // ── oms_send_batch ──────────────────────────────────────────────
  server.tool(
    'oms_send_batch',
    'Send up to 100 transactional emails in one call (OMS-24). Use ' +
      'this when you need to fan out a flow (e.g. welcome-mail to a ' +
      'list of 50 freshly imported users) — avoids N×rate-limit hits + ' +
      'returns one consolidated quota snapshot. Each message is ' +
      'validated + delivered independently; partial failures surface in ' +
      'the `results` array with per-item `ok` flag. The first quota-' +
      'exhaust stops subsequent items (marked `quotaSkipped=true`). ' +
      'Always returns 200; inspect `summary` + `results` to decide retry.',
    {
      messages: z
        .array(
          z.object({
            from: z.string().email(),
            to: z.string().email(),
            subject: z.string().min(1).optional(),
            body_html: z.string().optional(),
            body_text: z.string().optional(),
            tags: z.record(z.string()).optional(),
          }),
        )
        .min(1)
        .max(100),
    },
    async (args) => {
      const r = await omsFetch('POST', '/v1/send/batch', {
        messages: args.messages.map((m) => ({
          from: m.from,
          to: m.to,
          subject: m.subject,
          html: m.body_html,
          text: m.body_text,
          tags: m.tags,
        })),
      });
      return asResult(r);
    },
  );

  // ── oms_send_template ───────────────────────────────────────────
  server.tool(
    'oms_send_template',
    'Render a server-side template and send the rendered mail through ' +
      'OMS. Variables are validated against the template\'s stored schema ' +
      'before render; mismatches return a 400 template_variable_validation. ' +
      'Use this when the customer has a defined template (welcome, password-reset, etc.); ' +
      'use oms_list_templates to discover available template IDs.',
    {
      template_id: z.string().uuid().describe('The template UUID from oms_list_templates.'),
      from: z.string().email().describe('Sender address (must be authorized).'),
      to: z.string().email().describe('Recipient address.'),
      variables: z
        .record(z.unknown())
        .optional()
        .describe('Variables for the template body. Must match the template variables_schema.'),
      subject: z
        .string()
        .optional()
        .describe('Optional subject override. Defaults to the template subject.'),
      tags: z.record(z.string()).optional(),
    },
    async (args) => {
      const r = await omsFetch('POST', '/v1/send', {
        from: args.from,
        to: args.to,
        subject: args.subject,
        templateId: args.template_id,
        variables: args.variables ?? {},
        tags: args.tags,
      });
      return asResult(r);
    },
  );

  // ── oms_get_quota ───────────────────────────────────────────────
  server.tool(
    'oms_get_quota',
    'Read the current month\'s quota snapshot. Returns current/total/' +
      'percentUsed/softWarnTriggered + capReason for monthly limits, ' +
      'plus dailyCap/dailyCurrent/dailyRemaining/dayResetAt for the ' +
      'per-day cap (Free tier only; null on paid tiers). Use before ' +
      'composing a bulk-send to decide whether to ask the user for ' +
      'confirmation. If dailyRemaining is 0, the next send returns 402 ' +
      'with reason `quota_exhausted_daily` — wait until dayResetAt or ' +
      'upgrade.',
    {},
    async () => {
      const r = await omsFetch('GET', '/v1/quota');
      return asResult(r);
    },
  );

  // ── oms_list_recent_sends ───────────────────────────────────────
  server.tool(
    'oms_list_recent_sends',
    'List the customer\'s recent sends, most-recent first. Cursor-' +
      'paginated; pass the previous response\'s `nextCursor` as `cursor` ' +
      'to advance. Optional filters: status, region. Useful for answering ' +
      '"did the welcome mail go out?" or for detecting a stuck flow before ' +
      'retrying.',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Default 20, max 100.'),
      cursor: z
        .string()
        .optional()
        .describe('Opaque cursor from a previous response\'s `nextCursor`.'),
      status: z
        .enum(['queued', 'delivered', 'bounced', 'complained', 'rejected'])
        .optional()
        .describe('Filter by send status.'),
      region: z.enum(['eu-central-1', 'eu-west-1']).optional(),
    },
    async (args) => {
      const params = new URLSearchParams();
      params.set('limit', String(args.limit ?? 20));
      if (args.cursor) params.set('cursor', args.cursor);
      if (args.status) params.set('status', args.status);
      if (args.region) params.set('region', args.region);
      const r = await omsFetch('GET', `/v1/sends?${params.toString()}`);
      return asResult(r);
    },
  );

  // ── oms_check_suppression ───────────────────────────────────────
  server.tool(
    'oms_check_suppression',
    'Check whether a recipient is on the customer\'s suppression list. ' +
      'Always check before sending to a freshly-typed-by-the-user address — ' +
      'OMS would 422 the send otherwise + you save the round-trip.',
    {
      email: z.string().email(),
    },
    async (args) => {
      const r = await omsFetch('GET', `/v1/suppression/${encodeURIComponent(args.email)}`);
      return asResult(r);
    },
  );

  // ── oms_add_to_suppression ──────────────────────────────────────
  server.tool(
    'oms_add_to_suppression',
    'Manually add an address to the customer\'s suppression list. ' +
      'Default reason is `manual`; use `hard-bounce` or `complaint` only ' +
      'with explicit user direction (those reasons are normally set by the ' +
      'SES-event handler on actual bounces/complaints).',
    {
      email: z.string().email(),
      reason: z.enum(['manual', 'hard-bounce', 'complaint']).optional(),
    },
    async (args) => {
      const r = await omsFetch('POST', '/v1/suppression', {
        email: args.email,
        reason: args.reason ?? 'manual',
      });
      return asResult(r);
    },
  );

  // ── oms_list_templates ──────────────────────────────────────────
  server.tool(
    'oms_list_templates',
    'List the customer\'s server-side templates with their variable ' +
      'schemas. Returns id + name + subject + variablesSchema for each. ' +
      'Use this to discover template_ids before calling oms_send_template.',
    {},
    async () => {
      const r = await omsFetch('GET', '/v1/templates');
      return asResult(r);
    },
  );

  // ── oms_list_webhooks ───────────────────────────────────────────
  server.tool(
    'oms_list_webhooks',
    'List the customer\'s outbound-event webhook subscriptions. Each ' +
      'row returns url, label, event_filters, enabled flag, last-success/' +
      'failure timestamps. Signing secrets are stripped on list responses.',
    {},
    async () => {
      const r = await omsFetch('GET', '/v1/webhooks');
      return asResult(r);
    },
  );

  // ── oms_create_webhook ──────────────────────────────────────────
  server.tool(
    'oms_create_webhook',
    'Create a new outbound webhook subscription. The response includes ' +
      'a plaintext signing secret — surface it to the user EXACTLY ONCE ' +
      'so they can persist it. Subsequent GETs strip the secret.',
    {
      url: z.string().url().describe('Target https:// URL (or http://localhost in dev).'),
      label: z.string().max(128).optional(),
      event_filters: z
        .array(
          z.enum([
            'quota.soft-warn-80',
            'quota.soft-warn-95',
            'quota.exhausted-base',
            'quota.exhausted-cap',
            'bounce.permanent',
            'bounce.transient',
            'complaint',
            'delivery',
          ]),
        )
        .optional()
        .describe('Empty / omitted = subscribe to all events.'),
    },
    async (args) => {
      const r = await omsFetch('POST', '/v1/webhooks', {
        url: args.url,
        label: args.label,
        eventFilters: args.event_filters,
      });
      return asResult(r);
    },
  );

  // ── oms_delete_webhook ──────────────────────────────────────────
  server.tool(
    'oms_delete_webhook',
    'Remove a webhook subscription by id. Use oms_list_webhooks first ' +
      'to discover the id.',
    { id: z.string().uuid() },
    async (args) => {
      const r = await omsFetch('DELETE', `/v1/webhooks/${encodeURIComponent(args.id)}`);
      return asResult(r);
    },
  );

  return server;
}

/**
 * Marker preserved for back-compat with the placeholder smoke test
 * shipped in OMS-1. New tests should reach for `createServer()` and
 * test tool behavior directly; the marker is harmless re-export.
 */
export const PLACEHOLDER = true as const;
