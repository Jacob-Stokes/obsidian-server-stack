# Existing LiveSync server

For vaults that already sync through the [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) plugin. This option adds the server as one more device on the existing CouchDB instead of running a new one, and mirrors the vault into plain files for `obsidian-api`.

Configuration is imported from a LiveSync Setup URI, so end-to-end encryption, path obfuscation and other settings carry over unchanged.

Anything written through the MCP goes straight into the real vault on every device. Trying it with a test vault first is recommended.

## Setup

The root `install.sh` handles this (option 5). To set it up manually:

1. In Obsidian, on a device that already syncs: **Settings → Self-hosted LiveSync → Setup → Copy the setup URI**, and choose a passphrase when prompted.
2. Import it. The passphrase is read from stdin and is not written to `.env`:
   ```bash
   cp .env.example .env
   read -rsp "Setup URI passphrase: " P; echo
   printf '%s\n' "$P" | docker compose run --rm -T -e SETUP_URI='obsidian://setuplivesync?settings=...' vault-sync setup
   ```
3. Start it with `docker compose up -d`, then check `docker compose logs -f`.

The decoded settings, including the CouchDB password and encryption passphrase, are stored in the `vault-sync-db` Docker volume. `docker compose down -v` deletes them.
