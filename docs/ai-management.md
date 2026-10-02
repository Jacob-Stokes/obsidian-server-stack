# Managing the stack from AI tools (optional)

`obsidian-stack manager enable` lets AI tools connected to the MCP manage the install itself. Five `obsidian_stack_*` tools appear:

| Tool | Does |
|---|---|
| `obsidian_stack_status` | The core containers and every vault: sync source and state, note count, Obsidian app |
| `obsidian_stack_vaults` | Add a vault (self-hosted LiveSync, Official Sync, git or none), rename one, or remove one (its notes are kept) |
| `obsidian_stack_sync` | Restart a vault's sync, read its recent logs, or fetch a LiveSync vault again after a device rebuilt it |
| `obsidian_stack_app` | Turn the Obsidian app on or off for a vault |
| `obsidian_stack_setup_uri` | A Setup URI and passphrase for a self-hosted LiveSync vault's devices |

It's off by default because it needs Docker, which is root-equivalent on the server. It runs in its own container ([`extras/manager`](https://github.com/Jacob-Stokes/obsidian-server-stack/blob/main/extras/manager)), separate from the MCP, and only performs those operations, each as an `obsidian-stack` command with checked arguments: no raw Docker, no uninstall or update, no deleting notes. Some things stay at the terminal: Official Sync vaults can only be added by reusing an account already signed in on the server, and joining an existing LiveSync server needs its Setup URI and passphrase. Setup URIs, passphrases and git deploy keys it creates are returned to the AI client, so they appear in that conversation. With the manager on, keep the MCP private or behind OAuth. The reasoning: [docs/decisions/001-mcp-stack-management.md](decisions/001-mcp-stack-management.md).
