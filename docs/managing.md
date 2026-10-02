# Managing with obsidian-stack

`obsidian-stack` manages one install: adding and removing vaults, checking sync, reading logs. Run with no arguments, it opens an interactive menu.

| Command | Does |
|---|---|
| `obsidian-stack` | Interactive menu |
| `obsidian-stack status` | Core containers, and each vault's sync state and note count |
| `obsidian-stack vaults` | List vaults |
| `obsidian-stack add` / `remove [id]` | Add a vault, or remove one (its files are kept) |
| `obsidian-stack app enable\|disable <id>` | The optional Obsidian app for a vault (below) |
| `obsidian-stack resync <id>` | Self-hosted LiveSync: fetch the vault again, after a device rebuilt it |
| `obsidian-stack setup-uri <id> [--url]` | Setup URI for a self-hosted LiveSync vault's devices; `--url` changes the address they connect to |
| `obsidian-stack logs <id\|api\|mcp\|couchdb> [-f]` | Logs for a vault's sync or a core container |
| `obsidian-stack restart <id\|api\|mcp\|couchdb\|all>` | Restart one part, or everything |
| `obsidian-stack update` | `git pull`, rebuild, and restart everything on the new version |
| `obsidian-stack endpoint [--show-token]` | MCP URL and bearer token |
| `obsidian-stack link [name]` | Add the command to `/usr/local/bin` |
| `obsidian-stack manager enable\|disable` | Let AI tools manage this install ([below](ai-management.md)) |
| `obsidian-stack licenses [--full]` | Licences of the stack and of everything it uses; `--full` shows the full texts |
| `obsidian-stack uninstall [--yes]` | Remove the install's containers, images and command; notes are kept unless chosen |

Every question it asks can also be answered with an option, for scripts: `obsidian-stack add --yes --name Work --source livesync --device-url https://couchdb.example.com` (`obsidian-stack help` lists them). `--yes` takes the default for anything not given; secrets such as an encryption password come from environment variables, never options. `status`, `vaults` and `setup-uri` have `--json` output.

The command always acts on the install it belongs to: the folder it lives in (following the link on the PATH), or one given with `--dir` or `$OBSIDIAN_STACK_DIR`. Every container the stack creates carries a Docker label with the install's `STACK_ID` from `.env`, and the command finds containers by that label rather than by name, so other Obsidian containers on the machine are never affected.
