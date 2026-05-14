/**
 * @orboto/mail-mcp — MCP server for the Orboto Mail Service.
 *
 * Placeholder. Full implementation lands in OMS-11. When that ticket
 * ships, this entry point will export an MCP-protocol server that
 * surfaces the following tools to Claude Code agents:
 *
 *   - oms_send_email
 *   - oms_send_template
 *   - oms_get_quota
 *   - oms_list_recent_sends
 *   - oms_check_suppression
 *   - oms_add_to_suppression
 *   - oms_list_templates
 *
 * Auth: same Bearer-token as the REST API + SDK. The MCP server reads
 * `OMS_API_KEY` from env (or accepts `--api-key`). All tool responses
 * include `remainingQuota` so the agent can decide whether to retry or
 * back off.
 *
 * See `evaluation/adr-orboto-mail-service.md` §AI-Agent integration
 * for the full contract.
 */

export const PLACEHOLDER = true;
