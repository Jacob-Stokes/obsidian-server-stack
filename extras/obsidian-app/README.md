# Obsidian app (optional add-on, one per vault)

The full Obsidian desktop app for one vault, in a browser tab, plus a small service through which `obsidian-mcp` runs Obsidian commands and manages community plugins with the [official Obsidian CLI](https://obsidian.md/help/cli). See the main README for what it's for.

## Setup

`obsidian-stack app enable <id>` handles it: it writes `state/<id>/app.env` (port, login, shared token), pre-writes Obsidian's settings so it opens the vault with the CLI on, adds the vault's app to `vaults.compose.yml` (from `vault.yml` here) as the service `<id>-app`, starts it and offers to turn off restricted mode. From the install folder: `docker compose up -d <id>-app`.

## How it fits together

- **`app`**: [LinuxServer.io's Obsidian image](https://docs.linuxserver.io/images/docker-obsidian/), pinned to a version, with the vault at `/vault` and Obsidian's settings in `state/<id>/app/`.
- **`server.py`**: runs inside the same container as an s6 service (`obsidian-cli.service`). It listens on port 7310 for `obsidian-mcp` (bearer `OBSIDIAN_APP_TOKEN`) and runs one `obsidian <command>` per request.
  - The Obsidian CLI reaches the running app through a socket in `/tmp` and a lock that names the app's hostname and process id. A CLI started anywhere it can't see those starts a second copy of Obsidian instead.
  - So the service lives inside the app's container rather than in a separate one, and checks before every call that the app holding the lock is alive.
  - It also relaunches Obsidian if it exits, which is what happens when its window is closed in the browser.
- **Reachable over HTTP:**
  - listing and running commands, filtered by `APP_COMMANDS`;
  - community plugins: search (Obsidian's directory, by downloads), info, install, update, uninstall, enable, disable, and each plugin's settings (`data.json`);
  - themes and CSS snippets;
  - Bases (list, views, query, create an item), link health (orphans, dead ends, unresolved links) and screenshots of the app.

  `APP_EXTENSIONS=read` makes plugins, themes and snippets read-only. `eval` and the other CLI commands are only available through `obsidian-stack app run`.
- **Workarounds for gaps in the CLI**, all found by testing:
  - Installs finish after the CLI returns, so the service waits for the plugin or theme to appear.
  - There's no update command, so `update` reinstalls the plugin and restores its settings.
  - Some listings ignore `format=json`.
  - Obsidian doesn't always notice a new snippet file, so the service asks it to rescan (`app.customCss.readSnippets()`, the only `eval` it runs).
  - Plugin settings are written with the plugin switched off, so it can't save its old copy over them.
