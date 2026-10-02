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

Because credentials are per vault, one install can mix sources and accounts: two vaults on different Obsidian Sync accounts, one on git, another joining a LiveSync server elsewhere, and so on.

Self-hosted LiveSync and HTTPS for phones: [Self-hosted LiveSync](livesync.md).
