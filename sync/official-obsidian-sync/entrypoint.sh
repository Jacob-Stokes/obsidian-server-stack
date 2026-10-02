#!/bin/sh
# Lean wrapper around `ob` (obsidian-headless). One job: get a vault synced
# continuously; get-token is the one-time bootstrap step.
set -e

if [ "$1" = "get-token" ]; then
  echo "Logging in to Obsidian..."
  ob login
  TOKEN_FILE="${XDG_CONFIG_HOME}/obsidian-headless/auth_token"
  if [ -f "$TOKEN_FILE" ]; then
    # Not printed: obsidian-stack reads it from this file (it's a login
    # secret), at state/<id>/official/config/obsidian-headless/auth_token.
    echo
    echo "Signed in to Obsidian."
  else
    echo "Couldn't find the token file automatically. Try:" >&2
    echo "  find \$XDG_CONFIG_HOME -name auth_token" >&2
    exit 1
  fi
  exit 0
fi

if [ "$1" = "list-vaults" ]; then
  # One vault name per line (own vaults, then shared ones) for install.sh.
  ob sync-list-remote --json | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const j = JSON.parse(s);
      for (const v of [...(j.vaults || []), ...(j.shared || [])]) console.log(v.name);
    });'
  exit 0
fi

# Signed in with get-token instead of OBSIDIAN_AUTH_TOKEN: use the saved token.
TOKEN_FILE="${XDG_CONFIG_HOME}/obsidian-headless/auth_token"
if [ -z "${OBSIDIAN_AUTH_TOKEN:-}" ] && [ -s "$TOKEN_FILE" ]; then
  OBSIDIAN_AUTH_TOKEN="$(cat "$TOKEN_FILE")"
  export OBSIDIAN_AUTH_TOKEN
fi
[ -n "${OBSIDIAN_AUTH_TOKEN:-}" ] || { echo "OBSIDIAN_AUTH_TOKEN is not set. Run: docker compose run --rm obsidian-sync get-token" >&2; exit 1; }
[ -n "${VAULT_NAME:-}" ] || { echo "VAULT_NAME is not set — add it to the vault's state/<id>/sync.env (see README.md)." >&2; exit 1; }

setup_sync() {
  echo "Setting up sync for vault '${VAULT_NAME}'..."
  if [ -n "${VAULT_PASSWORD:-}" ]; then
    ob sync-setup --vault "$VAULT_NAME" --path /vault --password "$VAULT_PASSWORD"
  else
    ob sync-setup --vault "$VAULT_NAME" --path /vault
  fi
}

# One-off steps install.sh runs, so a wrong encryption password is caught
# while you're still at the prompt rather than in a restart loop later.
case "${1:-}" in
  is-configured) ob sync-status --path /vault --json >/dev/null 2>&1; exit $? ;;
  setup) setup_sync; exit 0 ;;
esac

# ob sync-setup rewrites the sync config from scratch, so only run it once —
# re-running it on every restart re-queues everything as a pending download.
if ! ob sync-status --path /vault --json >/dev/null 2>&1; then
  setup_sync
else
  echo "Vault '${VAULT_NAME}' already configured — skipping setup."
fi

if [ -n "${DEVICE_NAME:-}" ]; then
  ob sync-config --path /vault --device-name "$DEVICE_NAME" 2>/dev/null || true
fi

# Settings sync (.obsidian: plugins and their settings, appearance, hotkeys),
# the same categories as Obsidian Sync's settings on a device. Off unless
# SYNC_CONFIGS is set; "none" turns it off again. Used with the Obsidian app
# add-on, so the server's app runs the same plugins as the other devices.
case "${SYNC_CONFIGS:-}" in
  "") ;;
  none) ob sync-config --path /vault --configs "" >/dev/null ;;
  *) ob sync-config --path /vault --configs "$SYNC_CONFIGS" >/dev/null ;;
esac

echo "Starting continuous sync for '${VAULT_NAME}'..."
case "${SYNC_CONFIGS:-}" in
  ""|none) exec ob sync --continuous --path /vault ;;
esac

# With settings sync on: ob's live watcher picks up note changes but not
# changes under .obsidian, which it only uploads on the full scan it does when
# it connects (found by testing: a plugin installed on the server only went
# up after a restart). So run it as a child, check for changed settings files
# every 5s, and once they've stopped changing (a plugin install writes several
# files), restart it so they upload. workspace*.json is open tabs, which
# Obsidian Sync doesn't sync anyway.
marker=/tmp/.settings-scanned
touch "$marker"
changed() { [ -n "$(find /vault/.obsidian -type f -newer "$1" ! -name 'workspace*.json' 2>/dev/null | head -n 1)" ]; }
trap 'kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; exit 0' TERM INT
while :; do
  ob sync --continuous --path /vault &
  pid=$!
  while sleep 5; do
    kill -0 "$pid" 2>/dev/null || { wait "$pid"; exit $?; }  # ob stopped by itself: let Docker restart us
    changed "$marker" || continue
    # changed since the last scan; wait until a 5s round passes with no writes
    touch /tmp/.settings-quiet
    sleep 5
    changed /tmp/.settings-quiet && continue
    touch "$marker"
    echo "Settings changed on this server; reconnecting so they upload..."
    kill "$pid"; wait "$pid" 2>/dev/null
    break
  done
done
