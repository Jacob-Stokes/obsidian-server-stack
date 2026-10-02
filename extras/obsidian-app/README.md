# Obsidian app (optional add-on, one per vault)

The full Obsidian desktop app for one vault, in a browser tab, plus a small service through which `obsidian-mcp` runs Obsidian commands and manages community plugins with the [official Obsidian CLI](https://obsidian.md/help/cli). See the main README for what it's for.

## Setup

`obsidian-stack app enable <id>` handles it: it writes `state/<id>/app.env` (port, login, shared token), pre-writes Obsidian's settings so it opens the vault with the CLI on, starts the container and offers to turn off restricted mode. Each vault's app is its own compose project, `obsidian-<id>-app`:

```bash
docker compose -p obsidian-<id>-app --project-directory extras/obsidian-app \
  -f extras/obsidian-app/docker-compose.yml --env-file state/<id>/app.env up -d
```

## How it fits together

- **`app`**: [LinuxServer.io's Obsidian image](https://docs.linuxserver.io/images/docker-obsidian/), pinned to a version, with the vault at `/vault` and Obsidian's settings in `state/<id>/app/`.
- **`server.py`**: runs inside the same container as an s6 service (`obsidian-cli.service`). It listens on port 7310 for `obsidian-mcp` (bearer `OBSIDIAN_APP_TOKEN`) and runs one `obsidian <command>` per request.
  - The Obsidian CLI reaches the running app through a socket in `/tmp` and a lock that names the app's hostname and process id. A CLI started anywhere it can't see those starts a second copy of Obsidian instead.
  - So the service lives inside the app's container rather than in a separate one, and checks before every call that the app holding the lock is alive.
  - It also relaunches Obsidian if it exits, which is what happens when its window is closed in the browser.
- **Reachable over HTTP:** listing and running commands (filtered by `APP_COMMANDS`), and listing, installing, enabling and disabling plugins. `eval` and the other CLI commands are only available through `obsidian-stack app run`.
