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

Most Obsidian MCP servers run on a personal computer, and many also need the Obsidian app open, so the vault is unreachable whenever that machine is off. This stack keeps a copy of the vault on an always-on server instead, synced with other devices and reachable by any MCP client over HTTP. It runs headless: no Obsidian app or virtual machine, just a few small containers and the notes as plain markdown files.

## Install

```bash
git clone https://github.com/Jacob-Stokes/obsidian-server-stack.git
cd obsidian-server-stack
./install.sh
```

Requires Linux with Docker (Compose v2), `openssl` and `curl`, plus `ssh-keygen` for git sync. Run as root or with sudo.

The installer generates secrets, starts the containers and offers a choice of sync backend. Once finished, the MCP endpoint is at `http://localhost:7002/mcp`, with its bearer token in `.env`. The installer is safe to re-run.

To run a second instance on the same machine, set a prefix and port before running `./install.sh`:

```bash
cp .env.example .env
sed -i 's/^INSTANCE_PREFIX=.*/INSTANCE_PREFIX=test-/; s/^MCP_PORT=.*/MCP_PORT=7102/' .env
```

## Containers

Always installed:

| Container | Job |
|---|---|
| `obsidian-mcp` | MCP server. The endpoint MCP clients connect to. |
| `obsidian-api` | REST API over the vault files. Only `obsidian-mcp` can reach it. |

Plus one sync backend, or none. The installer lists the trade-offs of each.

| Option | Containers | On other devices | Cost |
|---|---|---|---|
| Self-hosted LiveSync | `livesync-couchdb`, `livesync-vault-sync` | [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) plugin | Free |
| Existing LiveSync server | `livesync-existing-sync` | An existing LiveSync setup, joined via Setup URI | Free |
| Official Obsidian Sync | `obsidian-official-sync` ([obsidian-headless](https://github.com/obsidianmd/obsidian-headless)) | Obsidian Sync | [Subscription](https://obsidian.md/sync) |
| Git | `obsidian-git-sync` | [obsidian-git](https://github.com/Vinzent03/obsidian-git) plugin | Free |
| None | | `./vault` is managed manually | Free |

Obsidian mobile needs HTTPS to use LiveSync. `sync/self-hosted-livesync` has optional [Caddy](https://caddyserver.com), [Tailscale](https://tailscale.com) and [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) setups for that.

## Reaching the MCP

The MCP listens on `localhost:7002` only. Remote access is left to an existing tool, such as:

- [Tailscale Serve](https://tailscale.com/kb/1312/serve): private to the tailnet. `tailscale serve --bg 7002`
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel): public URL, needed for web-based clients. `tailscale funnel --bg 7002`
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/): public URL on a custom domain, no open ports
- A reverse proxy such as [Caddy](https://caddyserver.com) or [nginx](https://nginx.org), if the server has a public IP

Clients authenticate with `Authorization: Bearer <MCP_BEARER_TOKEN>`. For clients that require an OAuth login, set the `MCP_OAUTH_*` values in `.env`. A public endpoint is protected only by that token.

## Updating and uninstalling

To update, run `git pull && ./install.sh` and select the same sync backend. Existing `.env` files and notes are preserved.

To uninstall, run `docker compose down` in the repo root and in the chosen `sync/` folder. Notes remain in `./vault` as plain markdown. Adding `-v` to the LiveSync `down` deletes the CouchDB database; other devices keep their copies. Stored credentials live in `sync/official-obsidian-sync/data/` and `sync/git-sync/ssh/`.

## Tools

All tool names start with `obsidian_`.

| Group | Tools |
|---|---|
| Read | `get_note`, `list_notes`, `search_notes`, `links`, `status` |
| Write | `write_note`, `append_to_note`, `patch_note`, `replace_in_note` |
| Organise | `move_note`, `delete_note` (moves to `.trash`), `bulk` |
| Metadata | `manage_frontmatter`, `manage_tags` |
| Other | `daily` (daily notes), `attachments` (non-markdown files) |

## License

MIT. The CouchDB setup in `sync/self-hosted-livesync` is adapted from [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync), also MIT. Obsidian's sync client, [obsidian-headless](https://www.npmjs.com/package/obsidian-headless), is installed from npm when the image is built and isn't included in this repo. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
