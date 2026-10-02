# Obsidian app (optional)

Everything above works on plain markdown files, with no Obsidian app on the server. Some things only the app can do: running community plugins such as [Linter](https://github.com/platers/obsidian-linter) or [Templater](https://github.com/SilentVoid13/Templater), or any command from the command palette. For those, `obsidian-stack app enable <id>` adds the full Obsidian app for one vault:

- **In a browser tab:** [LinuxServer.io's Obsidian image](https://docs.linuxserver.io/images/docker-obsidian/) runs the desktop app on the server, at `http://localhost:7300` behind a generated login (in `state/<id>/app.env`). Like the MCP, it listens on localhost only.
- **Driven by the MCP:** a small service in the same container works through the [official Obsidian CLI](https://obsidian.md/help/cli). Four tools appear for vaults with the app:

| Tool | Does |
|---|---|
| `obsidian_app_commands` | List commands, including plugins' commands (pass a note to see the ones that act on a note) |
| `obsidian_app_run_command` | Run a command, optionally on a given note |
| `obsidian_app_plugins` | Search the community directory; install, update, uninstall, enable and disable plugins; read and change each plugin's settings |
| `obsidian_app_appearance` | Search, install and switch themes; create, enable, disable and delete CSS snippets |
| `obsidian_app_bases` | List [Bases](https://obsidian.md/help/bases) and their views, query a view's rows as JSON (exactly as Obsidian evaluates them), and create a note through a base |
| `obsidian_app_vault_health` | Orphaned notes, dead ends and unresolved links, from Obsidian's own link index |
| `obsidian_app_screenshot` | An image of the app, optionally after opening a file: canvases, diagrams, Bases, plugin views such as Kanban. Any size per call (`width`, `height`, `scale`); 1600×1000 at 2× by default, set by `APP_SCREENSHOT_SIZE` |

- **Same files, no extra sync:** the app opens `vaults/<id>/` and doesn't sync by itself. The vault's own sync keeps that folder current, and the app picks up changes on disk. Its own sync (LiveSync plugin or Obsidian Sync) is best left off, as it would be a second sync client on the same folder.
- **Plugins from the other devices (Official Sync):** for an Official Sync vault, enabling the app offers to turn on settings sync as well. The other devices' community plugins, their settings, theme and hotkeys then come to the server, and the app runs them. Like the notes, it's two-way: plugin changes made on the server reach every device. So the same step asks whether the MCP may change plugins, and leaves them read-only unless told otherwise.

Enabling it asks whether to turn off Obsidian's restricted mode, which otherwise keeps community plugins from running. Plugins are code from their authors, and with restricted mode off they run on the server with access to the vault. Two settings in `state/<id>/app.env` limit what the MCP may do: `APP_COMMANDS` lists the commands it may run (for example `obsidian-linter:*,editor:*`), and `APP_EXTENSIONS=read` lets it see plugins, themes and snippets but not change them. Arbitrary JavaScript (`eval`) is never exposed. `obsidian-stack app run <id> <command>` runs any Obsidian CLI command directly, e.g. `plugins:restrict off`.

It's the heaviest part by far: 325–400 MB of RAM per vault while idle, against about 230 MB for the whole stack without it. Starting with 13 community plugins took about 870 MB before settling, and the browser tab adds more while open. The image is a 1.3 GB download and about 5 GB on disk. If Obsidian exits, including when its window is closed in the browser, it is reopened within about 30 seconds.

Each vault gets its own app container rather than sharing one. Obsidian can open several vaults in one container, and the CLI can target each, but in testing it saved almost no memory (two vaults in one container used about 675 MB, the same as two containers), since most of the cost is per window. It also let one vault's plugins read the other vaults, and resizing the shared screen for one vault's screenshots left the other vault's window the wrong size.
