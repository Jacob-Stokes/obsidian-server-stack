# Official Obsidian Sync

For vaults that already use [Obsidian Sync](https://obsidian.md/sync). This option runs a headless Obsidian Sync device that keeps a server-side copy of the vault up to date, so the MCP sees the latest notes without any other device being online.

The image is built from this folder and installs [`obsidian-headless`](https://www.npmjs.com/package/obsidian-headless) (Obsidian's official CLI, [source](https://github.com/obsidianmd/obsidian-headless)) from npm at build time. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

The root `install.sh` automates every step below except entering the Obsidian login (option 2). The manual steps are listed here for reference.

## Setup

1. The container runs as uid 1000, so the shared vault folder (`../../vault`) and `./data` must be owned by that uid before the first run. Otherwise sync setup fails with a permission error when it writes its local state:

   ```bash
   mkdir -p ../../vault data
   chown -R 1000:1000 ../../vault data
   ```

2. Create `.env`, leaving `OBSIDIAN_AUTH_TOKEN` blank for now. `docker compose` needs the file to exist before it runs anything, including the login in step 3:

   ```bash
   cp .env.example .env
   ```

3. Build the image and log in (one-time, interactive):

   ```bash
   docker compose build
   docker compose run --rm obsidian-sync get-token
   ```

   Enter the Obsidian account email, password and MFA code if enabled. The command prints an `OBSIDIAN_AUTH_TOKEN` when it finishes.

4. Set these values in `.env`:
   - `OBSIDIAN_AUTH_TOKEN`: from step 3.
   - `VAULT_NAME`: the exact vault name on the Obsidian Sync account. `docker compose run --rm obsidian-sync list-vaults` lists them.
   - `VAULT_PASSWORD`: only if the vault has end-to-end encryption enabled.

5. Start it:

   ```bash
   docker compose up -d
   docker compose logs -f
   ```

The vault is written to the repo root's `vault/` folder, the same one the root `docker-compose.yml` mounts into `obsidian-api`.

`ob sync-setup` runs only once. Running it again would rewrite the sync configuration and queue every file for download, so it is skipped once `ob sync-status` reports the vault as configured. That state, along with the login, is kept in `./data`, which must be preserved between restarts.
