# How it works

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
| Self-hosted LiveSync | `obsidian-<id>-livesync`, plus one shared `obsidian-couchdb` | [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) plugin, set up from a generated Setup URI | Free |
| Existing LiveSync server | `obsidian-<id>-livesync` | An existing LiveSync setup, joined via Setup URI | Free |
| Official Obsidian Sync | `obsidian-<id>-official-sync` ([obsidian-headless](https://github.com/obsidianmd/obsidian-headless)) | Obsidian Sync | [Subscription](https://obsidian.md/sync) |
| Git | `obsidian-<id>-git-sync` | [obsidian-git](https://github.com/Vinzent03/obsidian-git) plugin | Free |
| None | | `vaults/<id>/` is managed manually | Free |

## One compose project

The whole install is one Docker Compose project, in the install folder:

| File | What's in it |
|---|---|
| `docker-compose.yml` | The core: `obsidian-api` and `obsidian-mcp`. Part of the repository. |
| `vaults.compose.yml` | Every vault's services (its sync, and the Obsidian app if enabled), CouchDB once a vault needs it, and the manager while it's on. Written by `obsidian-stack` from the vault list, and included by `docker-compose.yml`. |
| `.env`, `state/<id>/*.env` | Secrets and settings, read by the containers when they start. Neither compose file contains them. |

So `docker compose ps` in the install folder lists everything, `docker compose logs <id>-sync` shows a vault's sync, and `docker compose down` / `up -d` stop and start the whole install. Vaults are changed with `obsidian-stack` (it rewrites `vaults.compose.yml`), but nothing needs it to run.

All of the install's data is inside the folder, none in Docker volumes:

| Folder | Holds |
|---|---|
| `vaults/<id>/` | The notes |
| `state/<id>/` | Each vault's settings, credentials, sync state and LiveSync's local database |
| `state/couchdb/` | Self-hosted LiveSync's CouchDB |

Moving the install to another server is `docker compose down`, a copy of the folder, and `docker compose up -d` on the new one. Devices using self-hosted LiveSync connect by address, so they carry on if the new server keeps the same address; otherwise they need new Setup URIs (`obsidian-stack setup-uri <id> --url`).


Because credentials are per vault, one install can mix sources and accounts: two vaults on different Obsidian Sync accounts, one on git, another joining a LiveSync server elsewhere, and so on.

Self-hosted LiveSync and HTTPS for phones: [Self-hosted LiveSync](livesync.md).
