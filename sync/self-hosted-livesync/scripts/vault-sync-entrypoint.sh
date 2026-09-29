#!/bin/sh
# Materializes a LiveSync vault as real markdown files at /vault, using the
# LiveSync project's own headless CLI (livesync-cli). No Obsidian desktop, no
# VM, no Electron. Runs as uid 1000 (set via `user:` in compose); permissions
# on /vault and /data are fixed up beforehand by the vault-sync-init one-shot.
#
# Used by two sync options:
#   sync/self-hosted-livesync — settings written from COUCHDB_* env vars,
#                               pointing at the CouchDB container next to it.
#   sync/livesync-existing    — settings imported once from a Setup URI
#                               (`setup` mode below), for a LiveSync server
#                               you already use.
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
  exec livesync-cli --settings "$SETTINGS" setup "$SETUP_URI"
fi

if [ ! -f "$SETTINGS" ]; then
  if [ -z "${COUCHDB_USER:-}" ] || [ -z "${COUCHDB_PASSWORD:-}" ]; then
    echo "Not configured yet. Run the one-off setup with a Setup URI first (see README)." >&2
    exit 1
  fi
  echo "Writing sync settings for database '${COUCHDB_DATABASE:-obsidiannotes}'..."
  ENCRYPT=false
  [ -n "${VAULT_ENCRYPT_PASSPHRASE:-}" ] && ENCRYPT=true
  cat > "$SETTINGS" <<EOF
{
  "couchDB_URI": "${COUCHDB_URI:-http://couchdb:5984}",
  "couchDB_USER": "${COUCHDB_USER}",
  "couchDB_PASSWORD": "${COUCHDB_PASSWORD}",
  "couchDB_DBNAME": "${COUCHDB_DATABASE:-obsidiannotes}",
  "liveSync": true,
  "syncOnSave": true,
  "syncOnStart": true,
  "encrypt": ${ENCRYPT},
  "passphrase": "${VAULT_ENCRYPT_PASSPHRASE:-}",
  "usePluginSync": false,
  "isConfigured": true
}
EOF
fi

echo "Starting continuous vault <-> CouchDB sync..."
exec livesync-cli --settings "$SETTINGS" --vault "$VAULT_PATH" daemon
