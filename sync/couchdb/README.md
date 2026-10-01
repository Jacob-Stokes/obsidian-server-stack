# Shared CouchDB (self-hosted LiveSync)

One CouchDB server for every vault that uses the [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) plugin, with a database per vault named after the vault's id. Each of those vaults also gets its own worker (`sync/livesync`) that mirrors its database into real files in `vaults/<id>/`.

The CouchDB setup is adapted from the LiveSync project's own `docker/` folder. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Setup

`obsidian-stack` starts this the first time a vault chooses self-hosted LiveSync, generates the password into `.env`, creates the vault's database, and prints a Setup URI for devices (`obsidian-stack setup-uri <id>` prints another). To run CouchDB by hand:

```bash
cp .env.example .env          # then set COUCHDB_PASSWORD, and STACK_ID as in the root .env
docker network create obsidian-livesync
docker compose up -d
```

Vaults are configured through Setup URIs rather than by entering the address, username and password on each device, so that every device and the server's worker share the vault's encryption passphrase and settings. `COUCHDB_DEVICE_URL` in `.env` is the address put into device URIs.

## HTTPS

Obsidian on iOS and Android refuses `http://` addresses on every network, including a tailnet, so phones need CouchDB behind HTTPS. Three optional profiles provide it:

| Profile | Needs | Start with |
|---|---|---|
| `caddy` | A domain pointing at the server; automatic TLS | `docker compose --profile caddy up -d` |
| `tailscale` | A Tailscale auth key; no domain required | `docker compose --profile tailscale up -d` |
| `cloudflare` | A Cloudflare Tunnel token | `docker compose --profile cloudflare up -d` |

Each profile's settings are in `.env.example`. Once one is running, `obsidian-stack setup-uri <id> --url` sets the HTTPS address and prints a new Setup URI for each vault.

## Removing

`docker compose down` stops CouchDB. Adding `-v` also deletes every vault's database; devices keep their own copies.
