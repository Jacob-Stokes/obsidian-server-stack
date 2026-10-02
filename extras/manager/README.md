# Manager (optional add-on)

Lets AI tools connected to the MCP manage this install: add, rename and remove vaults, restart sync and read its logs, turn the Obsidian app on or off, and make Setup URIs. Off by default. The decision and its trade-offs: [docs/decisions/001-mcp-stack-management.md](../../docs/decisions/001-mcp-stack-management.md).

```bash
obsidian-stack manager enable     # asks first, explaining what it allows
obsidian-stack manager disable
```

## How it works

- **`manager.py`** runs in its own container with the Docker socket and the install folder, at the same path as on the host (`obsidian-stack` creates bind mounts by host path). It listens on port 7320 on the stack's internal network only, with Bearer `OBSIDIAN_MANAGER_TOKEN`.
- **Each request becomes one `obsidian-stack ... --yes` run**, one at a time, with every argument checked first: vault ids, names, `http(s)` addresses and git repository URLs against fixed patterns.
- **`obsidian-mcp`** offers five tools (`obsidian_stack_status`, `obsidian_stack_vaults`, `obsidian_stack_sync`, `obsidian_stack_app`, `obsidian_stack_setup_uri`), listed only while the token is set.

## What it won't do

- Raw Docker commands, a shell, `uninstall` or `update`.
- Delete notes: removing a vault keeps `vaults/<id>/`.
- Take passwords: Official Sync vaults only by reusing an account already signed in on the server. Joining an existing LiveSync server stays at the terminal.

## Image

Built from the official [`docker:cli`](https://hub.docker.com/_/docker) image (Apache-2.0) with Alpine packages for `bash`, Python and the tools `obsidian-stack` uses.
