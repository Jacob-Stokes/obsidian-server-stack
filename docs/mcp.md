# Connecting to the MCP

The MCP listens on `localhost:7002` only. Remote access is left to an existing tool, such as:

- [Tailscale Serve](https://tailscale.com/kb/1312/serve): private to the tailnet. `tailscale serve --bg 7002`
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel): public URL, needed for web-based clients. `tailscale funnel --bg 7002`
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/): public URL on a custom domain, no open ports
- A reverse proxy such as [Caddy](https://caddyserver.com) or [nginx](https://nginx.org), if the server has a public IP

Clients authenticate with `Authorization: Bearer <MCP_BEARER_TOKEN>`. For clients that require an OAuth login, set the `MCP_OAUTH_*` values in `.env`. A public endpoint is protected only by that token.

## Tools

All tool names start with `obsidian_`. Every tool except `list_vaults` takes a `vault_id`. With a single vault it can be omitted, and the server says so when a client connects; with several, an omitted id is refused with the list of vaults.

| Group | Tools |
|---|---|
| Vaults | `list_vaults` (id, name and sync source of each vault; optional search) |
| Read | `get_note`, `list_notes`, `search_notes`, `links`, `status` |
| Write | `write_note`, `append_to_note`, `patch_note`, `replace_in_note` |
| Organise | `move_note`, `delete_note` (moves to `.trash`), `bulk` |
| Metadata | `manage_frontmatter`, `manage_tags` |
| Other | `daily` (daily notes), `attachments` (non-markdown files) |

With the optional add-ons: [Obsidian app tools](obsidian-app.md) and [stack management tools](ai-management.md).
