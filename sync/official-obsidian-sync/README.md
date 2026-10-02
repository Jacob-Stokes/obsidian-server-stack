# Official Obsidian Sync (one per vault)

For vaults that already use [Obsidian Sync](https://obsidian.md/sync). Each such vault runs its own headless Obsidian Sync device that keeps `vaults/<id>/` up to date, so the MCP sees the latest notes without any other device being online.

The image is built from this folder and installs [`obsidian-headless`](https://www.npmjs.com/package/obsidian-headless) (Obsidian's official CLI, [source](https://github.com/obsidianmd/obsidian-headless)) from npm at build time. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Setup

`obsidian-stack add` automates every step except entering the Obsidian login. The login is reused for further Official Sync vaults on the same server. Each vault's client is a service in the install's compose project, `<id>-sync` (written into `vaults.compose.yml` from `vault.yml` here), with its settings in `state/<id>/sync.env` and its login and sync state in `state/<id>/official/`. From the install folder:

```bash
docker compose build <id>-sync
docker compose run --rm -it <id>-sync get-token    # interactive Obsidian login
docker compose run --rm -T <id>-sync list-vaults   # names on the account
docker compose up -d <id>-sync
```

`state/<id>/sync.env` needs `OBSIDIAN_AUTH_TOKEN` (saved by `get-token` in `state/<id>/official/config/obsidian-headless/auth_token`), `VAULT_NAME` (the exact name on the Obsidian Sync account) and, only for end-to-end encrypted vaults, `VAULT_PASSWORD`. The folders `vaults/<id>/` and `state/<id>/official/` must be owned by uid 1000.

Settings sync (`.obsidian`: plugins and their settings, appearance, hotkeys) is off unless `SYNC_CONFIGS` is set in `state/<id>/sync.env`, as a comma-separated list of Obsidian Sync's categories: `app`, `appearance`, `appearance-data`, `hotkey`, `core-plugin`, `core-plugin-data`, `community-plugin`, `community-plugin-data`. It's applied on every start; `none` turns it off. The headless client doesn't notice changes under `.obsidian` while connected (only notes), so with settings sync on, the container checks for changed settings every 5 seconds and reconnects to upload them, about 10 seconds after a change. `obsidian-stack app enable` offers to set it, since it's only useful with the Obsidian app add-on.

`ob sync-setup` runs only once. Running it again would rewrite the sync configuration and queue every file for download, so it is skipped once `ob sync-status` reports the vault as configured. That state is kept in `state/<id>/official/`, which must be preserved between restarts.
