# Docker Compose (without the installer)

The stack's services are ordinary compose services, and Docker Compose can build them straight from this repository, so a deployment can be a single hand-written compose file and its `.env`: nothing generated, nothing installed on the host. This suits servers where everything is kept as compose files. The [installer](installer.md) produces compose files too (one project, readable with `docker compose`), and writes each vault's services itself; this page is for writing them by hand instead.

## Quick start

[`examples/compose.yml`](https://github.com/Jacob-Stokes/obsidian-server-stack/blob/main/examples/compose.yml) serves one Official Sync vault. In a new folder, save it as `compose.yml` and create `.env` next to it:

```bash
VAULT_NAME=Notes            # the vault's name in Obsidian Sync
VAULT_PASSWORD=             # its end-to-end encryption password, if any
API_KEY=                    # openssl rand -hex 32
MCP_BEARER_TOKEN=           # openssl rand -hex 32
```

Then sign in to Obsidian once and start it:

```bash
docker compose run --rm obsidian-sync get-token
docker compose up -d
```

The MCP is at `http://localhost:7002/mcp`, with `MCP_BEARER_TOKEN` as its bearer token. The sign-in is saved in the `sync-state` volume; setting `OBSIDIAN_AUTH_TOKEN` in `.env` works instead.

## Settings

Without `obsidian-stack`, the vault list comes from the environment instead of `vaults/.registry.json`:

- `VAULTS` (obsidian-api): `id[:source[:name]]`, comma-separated, e.g. `notes:official,work:livesync:Work notes`. Each vault's folder is `<VAULTS_ROOT>/<id>`. While it's set, the registry file isn't used and `obsidian-stack` can't change the vaults.
- `CONFIG_PATHS` (obsidian-api, optional): folders inside `.obsidian` that the API may read and write, comma-separated, e.g. `.obsidian/icons` for an icon plugin's custom icons. The rest of `.obsidian` stays out of reach.

## Adding a vault

A vault is a sync service writing to a volume, and that volume mounted into `obsidian-api` under the vault's id. For a second Official Sync vault, `Work`, on the same account:

```yaml
services:
  obsidian-sync-work:
    image: obsidian-official-sync:v0.2.0   # the image the first vault's service built
    restart: unless-stopped
    environment:
      OBSIDIAN_AUTH_TOKEN: ${OBSIDIAN_AUTH_TOKEN:-}
      VAULT_NAME: Work
      VAULT_PASSWORD: ${WORK_VAULT_PASSWORD:-}
      DEVICE_NAME: server
    volumes:
      - work:/vault
      - work-sync-state:/data
```

Then, in `obsidian-api`, add the vault to `VAULTS` (`notes:official,work:official:Work`) and mount its volume (`- work:/vaults/work`), declare the `work` and `work-sync-state` volumes, and run `docker compose up -d`. The MCP lists the new vault straight away. With more than one vault, MCP clients pass a `vault_id` to every tool.

A git vault works the same way with the git sync service in [`sync/git-sync`](https://github.com/Jacob-Stokes/obsidian-server-stack/tree/main/sync/git-sync). Self-hosted LiveSync also needs CouchDB and a Setup URI for each vault's devices; the installer sets those up, and is the easier route for LiveSync.

## Updating

The `#…` at the end of each build context picks the version:

- a release tag, e.g. `#v0.2.0`: fixed until the tag in the file is changed
- `#main`: the latest; `docker compose up -d --build` fetches and rebuilds whatever changed since the last build

Plain `docker compose up -d` keeps the images already built either way.

## Not available this way

The installer's helpers: Setup URIs, `resync`, the [manager](ai-management.md) (adding vaults from an AI tool) and `app enable`. The [Obsidian app](obsidian-app.md) add-on is a compose file of its own, in [`extras/obsidian-app`](https://github.com/Jacob-Stokes/obsidian-server-stack/tree/main/extras/obsidian-app).
