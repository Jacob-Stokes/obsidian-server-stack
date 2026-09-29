# Self-hosted LiveSync

Runs a CouchDB server for the [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) plugin, plus a headless worker (`vault-sync`) that mirrors the database into plain markdown files in the shared vault folder, in both directions. Changes made on a device appear on the server within seconds, and changes made through the MCP reach devices just as quickly.

The CouchDB setup is adapted from the LiveSync project's own `docker/` folder. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Setup

The root `install.sh` handles this (option 3). To set it up manually:

1. `cp .env.example .env`, then set `COUCHDB_PASSWORD` to a strong value.
2. `docker compose up -d`, then check `docker compose logs -f`.
3. In the LiveSync plugin on each device, point it at the server with the CouchDB URL, username, password and database name from `.env`.

If end-to-end encryption is enabled in the plugin, set the same passphrase as `VAULT_ENCRYPT_PASSPHRASE` so the worker can decrypt notes.

## HTTPS

Obsidian mobile only connects to LiveSync over HTTPS. Three optional profiles provide it:

| Profile | Needs | Start with |
|---|---|---|
| `caddy` | A domain pointing at the server; automatic TLS | `docker compose --profile caddy up -d` |
| `tailscale` | A Tailscale auth key; no domain required | `docker compose --profile tailscale up -d` |
| `cloudflare` | A Cloudflare Tunnel token | `docker compose --profile cloudflare up -d` |

Each profile's settings are in `.env.example`.

## Removing

`docker compose down` stops the containers. Adding `-v` also deletes the CouchDB database; devices keep their own copies.
