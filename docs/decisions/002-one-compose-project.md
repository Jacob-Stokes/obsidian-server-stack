# 002: One compose project, written by obsidian-stack

**Status:** accepted, 2026-10-03

## Context

`obsidian-stack` ran each vault's sync, each Obsidian app, CouchDB and the manager as separate compose projects, started from generic compose files in `sync/` and `extras/` with a per-vault env file. The vault list was `vaults/.registry.json` and each vault's settings `state/<id>/sync.env`; LiveSync's local databases and CouchDB's data were in Docker volumes.

That worked, but:

- **Nothing in the install folder said what was running.** `docker compose ps` there showed only the API and MCP. The vaults' containers were visible only through `obsidian-stack status` or by their Docker labels.
- **It didn't fit how many people run servers**: as compose files they can read, version and manage with ordinary tools (Portainer, Dockge and similar show compose projects).
- **Moving or backing up an install meant more than the folder**: the Docker volumes had to be exported too.
- **A hand-written compose deployment** ([Docker Compose](../compose.md)) was a second, separate way of running the stack, with no CLI.

## Decision

The install is **one compose project**:

- `docker-compose.yml` (the core, in the repository) includes **`vaults.compose.yml`**, which `obsidian-stack` writes from the registry whenever vaults change: each vault's services, written out in full (`<id>-sync`, plus `<id>-sync-init` for LiveSync, and `<id>-app`), CouchDB's compose file (included) once a vault needs it, and the manager while it's on.
- The services come from templates next to each component (`sync/*/vault.yml`, `extras/obsidian-app/vault.yml`, `extras/manager/service.yml`), filled in with the vault's id and the install's prefix.
- **Secrets aren't written into compose files.** Containers read them from `state/<id>/*.env` and `.env` (`env_file`) when they start; the manager's token is a `${…}` reference to `.env`.
- **All data is inside the install folder**: LiveSync's local databases in `state/<id>/livesync-db`, CouchDB in `state/couchdb/`. No Docker volumes.
- The registry stays the record of vaults (names, sources, the app flag), read by the API on every request as before.
- Existing installs are moved over by `obsidian-stack update`: the old per-project containers are removed (the new ones have the same names) and each volume's data is copied into `state/`, then the volume removed.

## Consequences

- `docker compose ps`, `logs`, `up -d` and `down` in the install folder cover the whole install, and the install runs without `obsidian-stack` once set up. The CLI is how vaults are added and removed, because it writes the services and sets up each sync.
- Backing up or moving an install is copying one folder. Self-hosted LiveSync devices connect by address, so they need new Setup URIs only if the address changes.
- `vaults.compose.yml` belongs to `obsidian-stack`; edits to it are overwritten. Hand-written deployments are still possible, as their own compose files.
- Docker Compose 2.20 or newer is needed (`include:`); the installer checks.
- Adding vaults from AI tools still needs the manager, with the Docker socket (see [001](001-mcp-stack-management.md)), because something has to run `docker compose up` after the file changes.
- Each vault keeps its own containers, so vaults stay isolated from each other, and the sync code that was already tested is unchanged.
- Older Compose versions reject a resource declared both in a file and in a file it includes (Compose 5 merges them), so `vaults.compose.yml` uses the core's network without redeclaring it, and declares the LiveSync network only when CouchDB's file isn't included.

## Alternatives considered

- **Keep separate compose projects.** Simplest, but leaves the problems above.
- **Write vaults into the user's own compose file.** Editing a hand-written YAML file safely (formatting, comments, layouts the script didn't expect) is fragile; a separate generated file, included, avoids it.
- **One sync container per sync type, running many vaults, with the vault list in a database.** No Docker socket needed to add vaults, but it means rewriting the sync side and losing per-vault isolation. Worth revisiting if AI-driven vault management without the socket becomes important.
- **One `include:` entry per vault, pointing at the shared template with the vault's env file.** Compose doesn't interpolate service names, so every vault's services would have the same names.
