# @orboto/mail-mcp

MCP server for the Orboto Mail Service. Exposes the OMS API surface as MCP tools so Claude, Cursor, and other agent-aware clients can send mail, check quota, manage suppression, work with templates, browse inbound mail, and manage outbound webhooks.

## Install + run

```bash
# Per-call (recommended — always picks up the latest version)
npx @orboto/mail-mcp

# Or installed globally
npm install -g @orboto/mail-mcp
orboto-mail-mcp
```

Auth via `OMS_API_KEY` env var (same key as the [`@orboto/mail`](https://www.npmjs.com/package/@orboto/mail) SDK):

```bash
export OMS_API_KEY=oms_live_xxxxxxxxxxxx
npx @orboto/mail-mcp
```

## Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "orboto-mail": {
      "command": "npx",
      "args": ["@orboto/mail-mcp"],
      "env": {
        "OMS_API_KEY": "oms_live_xxxxxxxxxxxx"
      }
    }
  }
}
```

## Tools

| Tool                       | Purpose                                                    |
|----------------------------|------------------------------------------------------------|
| `oms_send_email`           | Send one transactional email                               |
| `oms_send_batch`           | Send up to 100 messages in one call (per-item outcomes)    |
| `oms_send_template`        | Render + send a server-side template                       |
| `oms_get_quota`            | Read current quota state (monthly + optional daily cap)    |
| `oms_list_recent_sends`    | Cursor-paginated send history with status filters          |
| `oms_check_suppression`    | Check whether an address is on the suppression list        |
| `oms_add_to_suppression`   | Manually add an address to the suppression list            |
| `oms_list_templates`       | Enumerate templates with their variables schema            |
| `oms_list_inbound`         | Cursor-paginated inbound mail history                      |
| `oms_get_inbound`          | Single inbound mail + 15-min presigned-URL for raw MIME    |
| `oms_list_webhooks`        | List outbound-event webhook subscriptions                  |
| `oms_create_webhook`       | Create a webhook subscription (secret shown ONCE)          |
| `oms_delete_webhook`       | Remove a webhook by id                                     |

Every tool response includes a `remainingQuota` snapshot so agents can decide whether to keep sending or pause for the user.

## License

[MIT](./LICENSE.md) — use it however you want.
