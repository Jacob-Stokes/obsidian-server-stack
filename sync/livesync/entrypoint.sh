#!/bin/sh
# Materializes a LiveSync vault as real markdown files at /vault, using the
# LiveSync project's own headless CLI (livesync-cli). No Obsidian desktop, no
# VM, no Electron. Runs as uid 1000 (set via `user:` in compose); permissions
# on /vault and /data are fixed up beforehand by the vault-sync-init one-shot.
#
# One worker per vault, configured once from a Setup URI (`setup` mode below):
#   self-hosted     — a URI obsidian-stack generates for the shared CouchDB in
#                     sync/couchdb, database named after the vault, with
#                     end-to-end encryption; devices get a matching URI.
#   existing server — the URI from a LiveSync setup already in use.
set -e

VAULT_PATH=/vault
DB_PATH=/data
SETTINGS="$DB_PATH/.livesync/settings.json"

# The image's own wrapper prepends $LIVESYNC_DB_PATH as the database-path
# argument itself; passing it again shifts every argument by one and the
# command gets rejected. Found by running this.
export LIVESYNC_DB_PATH="$DB_PATH"

mkdir -p "$(dirname "$SETTINGS")"

if [ "${1:-}" = "setup" ]; then
  # One-off: import settings from a Setup URI. The passphrase arrives on stdin
  # and is never written anywhere by us; the CLI stores the decoded settings
  # in $SETTINGS, which is all the daemon needs from then on.
  : "${SETUP_URI:?SETUP_URI is required for setup}"
  rm -f "$SETTINGS"
  livesync-cli --settings "$SETTINGS" setup "$SETUP_URI"
  # Setup URIs usually carry periodic sync (every 60s, batched saves), a
  # device-local choice. This copy serves the MCP, so it runs in LiveSync
  # mode: changes either way within seconds. Other devices are unaffected.
  node -e '
    const fs = require("fs"), f = process.argv[1];
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    Object.assign(s, { liveSync: true, periodicReplication: false, batchSave: false, syncOnStart: true });
    fs.writeFileSync(f, JSON.stringify(s, null, 2));
  ' "$SETTINGS"
  exit 0
fi

if [ ! -f "$SETTINGS" ]; then
  echo "Not configured yet: import a Setup URI first (obsidian-stack does this; see README)." >&2
  exit 1
fi

echo "Starting continuous vault <-> CouchDB sync..."
exec livesync-cli --settings "$SETTINGS" --vault "$VAULT_PATH" daemon
