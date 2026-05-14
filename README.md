# @orboto/mail-mcp

MCP server for the Orboto Mail Service. Exposes the OMS API surface as
MCP tools so Claude Code (or any MCP-compatible AI agent) can send mail,
check quota, manage suppression, and list templates.

> **Status: placeholder.** Full implementation lands in OMS-11. Until
> then, use the [`@orboto/mail`](../sdk/README.md) SDK directly.

When OMS-11 ships, this package will surface:

| Tool                       | Description                                            |
|----------------------------|--------------------------------------------------------|
| `oms_send_email`           | Send a transactional email                             |
| `oms_send_template`        | Render + send a server-side template                   |
| `oms_get_quota`            | Return current quota state (base + overage)            |
| `oms_list_recent_sends`    | List last N sends with status                          |
| `oms_check_suppression`    | Check whether an email is on the suppression list      |
| `oms_add_to_suppression`   | Manually add an email to the suppression list          |
| `oms_list_templates`       | Enumerate available templates with their schemas       |

Auth via `OMS_API_KEY` env var (same as the SDK). Every tool response
includes `remainingQuota` so agents can decide whether to keep sending
or back off.
