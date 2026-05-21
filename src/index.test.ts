/**
 * Tests for the @orboto/mail-mcp tool surface.
 *
 * We don't boot a full MCP transport — instead we exercise the tool
 * callbacks directly via the server's internal registry. That keeps
 * the test fast + transport-agnostic.
 */
import { describe, expect, it } from 'vitest';

import { createServer } from './index.js';

interface FakeFetchCall {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

function buildFakeFetch(
  response: { status: number; body: unknown },
  calls: FakeFetchCall[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body !== undefined ? String(init.body) : undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      statusText: response.status >= 400 ? 'Error' : 'OK',
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

/**
 * Walk the McpServer's internal registry to invoke a tool's callback.
 * The SDK doesn't expose a public test API for direct callback access,
 * so we reach into the registry directly — guarded by a runtime check
 * so we surface a clear failure if the SDK shape changes.
 */
async function invokeTool(server: ReturnType<typeof createServer>, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registry = (server as any)._registeredTools ?? (server as any).tools;
  if (!registry || typeof registry !== 'object') {
    throw new Error(
      'Could not access tool registry — McpServer internal shape changed. Update invokeTool().',
    );
  }
  const entry = registry[name];
  if (!entry) {
    throw new Error(`Tool not registered: ${name}`);
  }
  const callback = entry.callback ?? entry.handler ?? entry;
  if (typeof callback !== 'function') {
    throw new Error(`Tool ${name} has no invokable callback`);
  }
  return await callback(args, { signal: new AbortController().signal });
}

describe('createServer registers the seven tools', () => {
  it('throws when apiKey is missing', () => {
    expect(() => createServer({ apiKey: '' })).toThrowError(/apiKey is required/);
  });

  it('oms_get_quota issues a GET /v1/quota with the bearer token', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch(
      { status: 200, body: { current: 42, total: 100, percentUsed: 0.42 } },
      calls,
    );
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    const out = await invokeTool(server, 'oms_get_quota', {});

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/v1\/quota$/);
    expect(calls[0].headers.authorization).toBe('Bearer oms_test_xyz');
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content[0].text)).toMatchObject({ current: 42 });
  });

  it('oms_send_email POSTs /v1/send with the mapped body fields', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch(
      { status: 200, body: { messageId: 'msg-1', status: 'queued', overage: false } },
      calls,
    );
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    await invokeTool(server, 'oms_send_email', {
      from: 'noreply@acme.example.com',
      to: 'jane@example.com',
      subject: 'Hi',
      body_html: '<p>Hi</p>',
      tags: { workflow: 'welcome' },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v1\/send$/);
    const parsed = JSON.parse(calls[0].body!);
    expect(parsed).toEqual({
      from: 'noreply@acme.example.com',
      to: 'jane@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      tags: { workflow: 'welcome' },
    });
  });

  it('oms_send_template maps template_id + variables onto the send body', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch(
      { status: 200, body: { messageId: 'msg-2', status: 'queued', overage: false } },
      calls,
    );
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    await invokeTool(server, 'oms_send_template', {
      template_id: '11111111-1111-1111-1111-111111111111',
      from: 'noreply@acme.example.com',
      to: 'jane@example.com',
      variables: { name: 'Jane' },
    });

    const parsed = JSON.parse(calls[0].body!);
    expect(parsed.templateId).toBe('11111111-1111-1111-1111-111111111111');
    expect(parsed.variables).toEqual({ name: 'Jane' });
  });

  it('oms_check_suppression GETs /v1/suppression/:email url-encoded', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch(
      { status: 200, body: { email: 'a+b@example.com', suppressed: true } },
      calls,
    );
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    await invokeTool(server, 'oms_check_suppression', { email: 'a+b@example.com' });

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/v1/suppression/a%2Bb%40example.com');
  });

  it('oms_add_to_suppression POSTs body with default reason=manual', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch(
      { status: 200, body: { email: 'x@example.com', reason: 'manual' } },
      calls,
    );
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    await invokeTool(server, 'oms_add_to_suppression', { email: 'x@example.com' });

    const parsed = JSON.parse(calls[0].body!);
    expect(parsed).toEqual({ email: 'x@example.com', reason: 'manual' });
  });

  it('oms_list_templates GETs /v1/templates', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch({ status: 200, body: { templates: [] } }, calls);
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    await invokeTool(server, 'oms_list_templates', {});

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/v1\/templates$/);
  });

  it('oms_list_recent_sends respects --limit (default 20)', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch({ status: 200, body: { sends: [] } }, calls);
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    await invokeTool(server, 'oms_list_recent_sends', { limit: 50 });

    expect(calls[0].url).toContain('limit=50');
  });

  it('isError=true when OMS returns non-2xx', async () => {
    const calls: FakeFetchCall[] = [];
    const fetchImpl = buildFakeFetch(
      { status: 402, body: { error: 'quota_exhausted', reason: 'overage_cap_exceeded' } },
      calls,
    );
    const server = createServer({ apiKey: 'oms_test_xyz', fetchImpl });

    const out = await invokeTool(server, 'oms_send_email', {
      from: 'noreply@acme.example.com',
      to: 'jane@example.com',
      subject: 'Hi',
      body_text: 'Hi',
    });

    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text)).toMatchObject({
      error: 'quota_exhausted',
      reason: 'overage_cap_exceeded',
    });
  });
});

