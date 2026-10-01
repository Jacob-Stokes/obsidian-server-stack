# LiveSync worker (one per vault)

Mirrors a LiveSync database into a vault's folder, `vaults/<id>/`, as real files, in both directions, using the LiveSync project's own [headless CLI](https://github.com/vrtmrz/obsidian-livesync/tree/main/src/apps/cli). It's used two ways:

- **Self-hosted:** the database is `<id>` on this stack's shared CouchDB (`sync/couchdb`). `obsidian-stack` generates a Setup URI for the worker and matching ones for devices, from the encryption passphrase and id recovery code kept in `state/<id>/sync.env`.
- **Existing server:** the vault joins a LiveSync setup already in use, as one more device. Settings are imported once from a Setup URI, so end-to-end encryption, path obfuscation and other settings carry over unchanged. Writes through the MCP go straight into that real vault on every device, so trying it with a test vault first is recommended.

## Setup

`obsidian-stack add` handles both. Each vault's worker is its own compose project, `obsidian-<id>`, run from this folder with the vault's settings file:

```bash
docker compose -p obsidian-<id> --project-directory sync/livesync \
  -f sync/livesync/docker-compose.yml --env-file state/<id>/sync.env up -d
```

The Setup URI is applied once before that (the passphrase is read from stdin and isn't stored):

```bash
printf '%s\n' "$PASSPHRASE" | docker compose -p obsidian-<id> --project-directory sync/livesync \
  -f sync/livesync/docker-compose.yml --env-file state/<id>/sync.env \
  run --rm -T -e SETUP_URI='obsidian://setuplivesync?settings=...' livesync setup
```

After importing, the worker switches its own copy to LiveSync mode (continuous replication) so changes reach the vault folder within seconds; other devices keep whatever sync mode they use. The decoded settings, including any CouchDB password and encryption passphrase, are kept in the worker's `livesync-db` Docker volume; `down -v` deletes them.
