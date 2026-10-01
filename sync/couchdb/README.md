# Shared CouchDB (self-hosted LiveSync)

One CouchDB server for every vault that uses the [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) plugin, with a database per vault named after the vault's id. Each of those vaults also gets its own worker (`sync/livesync`) that mirrors its database into real files in `vaults/<id>/`.

The CouchDB setup is adapted from the LiveSync project's own `docker/` folder. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Setup

`obsidian-stack` starts this the first time a vault chooses self-hosted LiveSync, generates the password into `.env`, creates the vault's database and prints the settings for the plugin. To run it by hand:

```bash
cp .env.example .env          # then set COUCHDB_PASSWORD, and STACK_ID as in the root .env
docker network create obsidian-livesync
docker compose up -d
```

On each device, point the LiveSync plugin at `http://<server>:5984` with the username and password from `.env` and the vault's id as the database name.

## HTTPS

Obsidian mobile only connects to LiveSync over HTTPS. Three optional profiles provide it:

| Profile | Needs | Start with |
|---|---|---|
| `caddy` | A domain pointing at the server; automatic TLS | `docker compose --profile caddy up -d` |
| `tailscale` | A Tailscale auth key; no domain required | `docker compose --profile tailscale up -d` |
| `cloudflare` | A Cloudflare Tunnel token | `docker compose --profile cloudflare up -d` |

Each profile's settings are in `.env.example`.

## Removing

`docker compose down` stops CouchDB. Adding `-v` also deletes every vault's database; devices keep their own copies.
