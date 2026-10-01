<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.gif">
    <img src="assets/logo-light.gif" alt="Obsidian Server Stack logo" width="90">
  </picture>
</p>

<h1 align="center">Obsidian Server Stack</h1>

<p align="center">An Obsidian vault on a server, synced across devices and reachable over MCP.</p>

<p align="center">
  <a href="https://github.com/Jacob-Stokes/obsidian-server-stack/actions/workflows/build.yml"><img src="https://github.com/Jacob-Stokes/obsidian-server-stack/actions/workflows/build.yml/badge.svg" alt="Build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Jacob-Stokes/obsidian-server-stack" alt="MIT license"></a>
</p>

Most Obsidian MCP servers run on a personal computer, and many also need the Obsidian app open, so the vault is unreachable whenever that machine is off. This stack keeps copies of one or more vaults on an always-on server instead, each synced with other devices in its own way and all reachable by any MCP client over HTTP. It runs headless: no Obsidian app or virtual machine, just a few small containers and the notes as plain markdown files.

## Install

```bash
git clone https://github.com/Jacob-Stokes/obsidian-server-stack.git
cd obsidian-server-stack
./install.sh
```

Requires Linux with Docker (Compose v2), `openssl` and `curl`, plus `ssh-keygen` for git sync. Run as root or with sudo.

The installer generates secrets, starts the core containers, adds a first vault, and offers to put an `obsidian-stack` command on the PATH for managing the install afterwards. Once finished, the MCP endpoint is at `http://localhost:7002/mcp`, with its bearer token in `.env`.

## How it works

One install serves any number of vaults. Each vault is a folder of markdown files, `vaults/<id>/`, where the id comes from its name (`Work Notes` becomes `work-notes`). The list of vaults is `vaults/.registry.json`, managed by `obsidian-stack`.

Two containers serve every vault:

| Container | Job |
|---|---|
| `obsidian-mcp` | MCP server, the endpoint clients connect to. One bearer token covers every vault in the install. |
| `obsidian-api` | REST API over the vault folders. Only `obsidian-mcp` can reach it. Each request names its vault, and the vault list is re-read on every request, so vaults can be added or removed without a restart. |

MCP clients call `obsidian_list_vaults` to see the vaults, then pass a `vault_id` to every other tool. With a single vault the id can be left out; the server says which case applies when a client connects.

Each vault stays in sync with other devices on its own, with its own sync source, its own containers, and its own settings and credentials in `state/<id>/`:

| Source | Containers per vault | On other devices | Cost |
|---|---|---|---|
| Self-hosted LiveSync | `obsidian-<id>-livesync`, plus one shared `obsidian-couchdb` | [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) plugin, database `<id>` | Free |
| Existing LiveSync server | `obsidian-<id>-livesync` | An existing LiveSync setup, joined via Setup URI | Free |
| Official Obsidian Sync | `obsidian-<id>-official-sync` ([obsidian-headless](https://github.com/obsidianmd/obsidian-headless)) | Obsidian Sync | [Subscription](https://obsidian.md/sync) |
| Git | `obsidian-<id>-git-sync` | [obsidian-git](https://github.com/Vinzent03/obsidian-git) plugin | Free |
| None | | `vaults/<id>/` is managed manually | Free |

Because credentials are per vault, one install can mix sources and accounts: two vaults on different Obsidian Sync accounts, one on git, another joining a LiveSync server elsewhere, and so on. Self-hosted LiveSync vaults share one CouchDB server, with a database per vault. Obsidian mobile needs HTTPS to reach it; `sync/couchdb` has optional [Caddy](https://caddyserver.com), [Tailscale](https://tailscale.com) and [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) setups for that.

## Managing

`obsidian-stack` manages one install: adding and removing vaults, checking sync, reading logs. Run with no arguments, it opens an interactive menu.

| Command | Does |
|---|---|
| `obsidian-stack` | Interactive menu |
| `obsidian-stack status` | Core containers, and each vault's sync state and note count |
| `obsidian-stack vaults` | List vaults |
| `obsidian-stack add` / `remove [id]` | Add a vault, or remove one (its files are kept) |
| `obsidian-stack logs <id\|api\|mcp\|couchdb> [-f]` | Logs for a vault's sync or a core container |
| `obsidian-stack restart <id\|api\|mcp\|couchdb\|all>` | Restart one part, or everything |
| `obsidian-stack update` | `git pull`, rebuild, and restart everything on the new version |
| `obsidian-stack endpoint [--show-token]` | MCP URL and bearer token |
| `obsidian-stack link [name]` | Add the command to `/usr/local/bin` |

The command always acts on the install it belongs to: the folder it lives in (following the link on the PATH), or one given with `--dir` or `$OBSIDIAN_STACK_DIR`. Every container the stack creates carries a Docker label with the install's `STACK_ID` from `.env`, and the command finds containers by that label rather than by name, so other Obsidian containers on the machine are never affected.

## Running a second instance

Multiple vaults and multiple sync accounts fit in one install. A second, separate install is for vaults that need their own MCP endpoint and token, for example one set for one person or agent and another set for another, since a token sees every vault in its install. It's also a way to try a new version alongside a working one.

Give the second install its own prefix and port before running `./install.sh`:

```bash
cp .env.example .env
sed -i 's/^INSTANCE_PREFIX=.*/INSTANCE_PREFIX=test-/; s/^MCP_PORT=.*/MCP_PORT=7102/' .env
```

Its containers, networks and volumes get the prefix, and its command is named after it, e.g. `obsidian-stack-test`. If both use self-hosted LiveSync, the second also needs a different `COUCHDB_PORT` in `sync/couchdb/.env`.

## Reaching the MCP

The MCP listens on `localhost:7002` only. Remote access is left to an existing tool, such as:

- [Tailscale Serve](https://tailscale.com/kb/1312/serve): private to the tailnet. `tailscale serve --bg 7002`
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel): public URL, needed for web-based clients. `tailscale funnel --bg 7002`
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/): public URL on a custom domain, no open ports
- A reverse proxy such as [Caddy](https://caddyserver.com) or [nginx](https://nginx.org), if the server has a public IP

Clients authenticate with `Authorization: Bearer <MCP_BEARER_TOKEN>`. For clients that require an OAuth login, set the `MCP_OAUTH_*` values in `.env`. A public endpoint is protected only by that token.

## Updating and uninstalling

To update, run `obsidian-stack update`. The `.env`, vaults and sync settings are preserved, and every vault's sync is restarted on the new version.

To remove one vault, run `obsidian-stack remove <id>`. Its notes stay in `vaults/<id>/` and its settings in `state/<id>/` until deleted by hand.

To uninstall everything, run `docker compose down` in the repo root, `docker compose down` in `sync/couchdb` if any vault used self-hosted LiveSync, and `docker compose -p obsidian-<id> down` for each vault's sync. Notes remain in `vaults/` as plain markdown. Adding `-v` to the CouchDB `down` deletes its databases; other devices keep their copies.

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

## License

MIT. The CouchDB setup in `sync/couchdb` is adapted from [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync), also MIT. Obsidian's sync client, [obsidian-headless](https://www.npmjs.com/package/obsidian-headless), is installed from npm when the image is built and isn't included in this repo. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
