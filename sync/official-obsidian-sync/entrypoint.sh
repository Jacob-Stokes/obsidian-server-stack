#!/bin/sh
# Lean wrapper around `ob` (obsidian-headless). One job: get a vault synced
# continuously; get-token is the one-time bootstrap step.
set -e

if [ "$1" = "get-token" ]; then
  echo "Logging in to Obsidian..."
  ob login
  TOKEN_FILE="${XDG_CONFIG_HOME}/obsidian-headless/auth_token"
  if [ -f "$TOKEN_FILE" ]; then
    echo
    echo "OBSIDIAN_AUTH_TOKEN=$(cat "$TOKEN_FILE")"
    echo "Put that in .env, then: docker compose up -d"
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

[ -n "${OBSIDIAN_AUTH_TOKEN:-}" ] || { echo "OBSIDIAN_AUTH_TOKEN is not set. Run: docker compose run --rm obsidian-sync get-token" >&2; exit 1; }
[ -n "${VAULT_NAME:-}" ] || { echo "VAULT_NAME is not set — see .env.example." >&2; exit 1; }

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

echo "Starting continuous sync for '${VAULT_NAME}'..."
exec ob sync --continuous --path /vault
