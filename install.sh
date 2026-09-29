#!/usr/bin/env bash
# Installer for obsidian-server-stack. Brings up the core stack (obsidian-api +
# obsidian-mcp), then optionally one of the two sync backends. Safe to re-run
# — it won't overwrite an existing .env.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "docker compose (v2 plugin) is required."
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."
command -v curl >/dev/null 2>&1 || die "curl is required."

say "Setting up the core stack"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "created .env from .env.example"
else
  ok ".env already exists, leaving it alone"
fi

set_env() {
  # set_env KEY VALUE [force] — replaces KEY= in .env, only if currently
  # empty unless "force" is passed (for replacing a template placeholder).
  # Always quotes the written value: .env gets `source`d as a shell script
  # (see below), so an unquoted value with a space breaks it — e.g. a vault
  # name like "My Vault" parses as VAULT_NAME=My, then tries to run "Vault"
  # as a command. Found by actually entering one, not by inspection.
  local key="$1" val="$2" force="${3:-}"
  if grep -q "^${key}=" .env; then
    if [ -n "$force" ] || [ -z "$(grep "^${key}=" .env | cut -d= -f2-)" ]; then
      sed -i.bak "s#^${key}=.*#${key}=\"${val}\"#" .env && rm -f .env.bak
    fi
  else
    echo "${key}=\"${val}\"" >> .env
  fi
}

# shellcheck disable=SC1091
source .env 2>/dev/null || true

if [ -z "${API_KEY:-}" ]; then
  set_env API_KEY "$(openssl rand -hex 32)"
  ok "generated API_KEY"
fi
if [ -z "${MCP_BEARER_TOKEN:-}" ]; then
  set_env MCP_BEARER_TOKEN "$(openssl rand -hex 32)"
  ok "generated MCP_BEARER_TOKEN"
fi

# Re-read after generating.
# shellcheck disable=SC1091
source .env

# Catch a name collision before docker does — its error for this is a lot
# less clear than "these containers already exist, set INSTANCE_PREFIX."
# Matters most when running a second instance on a machine that already
# has one (e.g. testing this alongside an existing install).
#
# Only a *foreign* collision blocks — a container this same project already
# created (e.g. re-running after the core stack came up but sync setup
# didn't finish) is fine and must stay re-runnable, per the README's promise.
PROJECT="${INSTANCE_PREFIX:-}obsidian-server-stack"
FOREIGN=""
for n in "${INSTANCE_PREFIX:-}obsidian-api" "${INSTANCE_PREFIX:-}obsidian-mcp"; do
  if docker inspect "$n" >/dev/null 2>&1; then
    OWNER="$(docker inspect "$n" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null || true)"
    [ "$OWNER" = "$PROJECT" ] || FOREIGN="$FOREIGN $n"
  fi
done
if [ -n "$FOREIGN" ]; then
  die "container name(s) already in use by something else on this machine:
$(echo "$FOREIGN" | tr ' ' '\n' | sed '/^$/d;s/^/    /')
  Set INSTANCE_PREFIX in .env (e.g. INSTANCE_PREFIX=test-) to run a second,
  separate instance alongside the existing one, then re-run this script."
fi

mkdir -p "${VAULT_HOST_PATH:-./vault}"
# obsidian-api runs as uid/gid 1000 inside its container. If this directory
# ends up owned by someone else (e.g. you ran this as root), every write
# fails with EACCES. Found by actually testing this, not guessing.
if chown -R 1000:1000 "${VAULT_HOST_PATH:-./vault}" 2>/dev/null; then
  ok "vault directory ownership set for the container user"
else
  echo "  Warning: couldn't chown ${VAULT_HOST_PATH:-./vault} to 1000:1000 (not root?)."
  echo "  If writes fail with a 500 error later, run that chown yourself, or"
  echo "  chmod it permissive enough for uid 1000 to write."
fi

say "Starting obsidian-api and obsidian-mcp"
# --remove-orphans cleans up containers from older versions of this stack
# (e.g. the obsidian-landing service, which no longer exists).
docker compose up -d --build --remove-orphans

printf '  waiting for obsidian-mcp'
UP=""
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:${MCP_PORT:-7002}/health" >/dev/null 2>&1; then
    UP=1
    break
  fi
  printf '.'
  sleep 1
done
echo
[ -n "$UP" ] || die "obsidian-mcp didn't come up — check 'docker compose logs obsidian-mcp'"
ok "obsidian-mcp is up on http://localhost:${MCP_PORT:-7002}/mcp"

say "Sync backend"
cat <<'EOF'
  How should your notes get onto this machine?

  1) None
     + Nothing extra to run
     - You manage the vault folder yourself (rsync, Syncthing, etc.)

  2) Official Obsidian Sync
     + Easiest on your devices: just Obsidian's built-in Sync
     + Real-time, conflicts handled for you
     - Needs a paid Obsidian Sync subscription
     - One interactive login during setup

  3) Self-hosted LiveSync
     + Free, real-time, conflicts handled for you
     + Everything stays on your own server
     - Install and configure the Self-hosted LiveSync plugin on each device
     - Runs a CouchDB database alongside

  4) Git
     + Free, full version history, works with any git host
     - Syncs on a timer: changes take minutes, not seconds
     - Editing the same note on two devices between syncs gives a conflict
       (both versions are kept, but you tidy it up by hand)
     - Needs the obsidian-git plugin on each device

  5) Existing LiveSync server
     + Joins the LiveSync setup you already use, as one more device
     + Keeps your encryption and other settings exactly as they are
     - Needs a Setup URI from the plugin (Copy setup URI) and its passphrase
     - Anything written here goes straight into your real vault, so
       consider trying it with a test vault first

EOF
read -rp "  Choice [1]: " SYNC_CHOICE
SYNC_CHOICE="${SYNC_CHOICE:-1}"

case "$SYNC_CHOICE" in
  2)
    say "Official Obsidian Sync"
    ( cd sync/official-obsidian-sync
      # The shared vault folder was already chowned above; this is just the
      # client's own state directory.
      mkdir -p data
      if chown -R 1000:1000 data 2>/dev/null; then
        ok "data ownership set for the container user"
      else
        echo "  Warning: couldn't chown data to 1000:1000 (not root?)."
      fi

      if [ ! -f .env ]; then cp .env.example .env; fi
      [ -n "${INSTANCE_PREFIX:-}" ] && set_env INSTANCE_PREFIX "$INSTANCE_PREFIX"
      # shellcheck disable=SC1091
      source .env

      docker compose build

      if [ -z "${OBSIDIAN_AUTH_TOKEN:-}" ]; then
        # The one step that can't be scripted: your Obsidian email, password,
        # and MFA code have to be typed by you. Everything around this
        # moment is automated; this moment itself isn't, on purpose — a
        # script that could do this for you would need your raw account
        # password sitting in a file, which is worse than typing it once.
        say "Logging in to Obsidian (interactive)"
        # A typo'd password shouldn't end the install (`set -e` would, hence
        # `until`): show the client's error and offer another go.
        until docker compose run --rm -it obsidian-sync get-token; do
          echo
          echo "  Login didn't work (the error above says why)."
          read -rp "  Try again? [Y/n] " AGAIN
          case "$AGAIN" in
            [nN]*) echo "  Nothing else has been changed. Re-run ./install.sh when ready."; exit 1 ;;
          esac
        done
        echo
        # The login leaves the token in ./data (mounted at /data), so read it
        # from there rather than making you copy it off the screen.
        TOKEN_FILE=data/config/obsidian-headless/auth_token
        if [ -s "$TOKEN_FILE" ]; then
          TOKEN=$(cat "$TOKEN_FILE")
        else
          read -rp "  Paste the OBSIDIAN_AUTH_TOKEN value printed above: " TOKEN
        fi
        [ -n "$TOKEN" ] || die "no token entered"
        set_env OBSIDIAN_AUTH_TOKEN "$TOKEN"
        ok "saved OBSIDIAN_AUTH_TOKEN"
        source .env
      else
        ok "OBSIDIAN_AUTH_TOKEN already set, reusing it"
      fi

      if [ -z "${VAULT_NAME:-}" ] || [ "$VAULT_NAME" = "My Vault" ]; then
        # Offer the vaults on the account; fall back to typing the name if
        # the list can't be fetched.
        VAULTS=()
        while IFS= read -r v; do [ -n "$v" ] && VAULTS+=("$v"); done < <(
          docker compose run --rm -T obsidian-sync list-vaults </dev/null 2>/dev/null || true)
        VN=""
        if [ "${#VAULTS[@]}" -eq 1 ]; then
          VN="${VAULTS[0]}"
          ok "found one vault on your account: $VN"
        elif [ "${#VAULTS[@]}" -gt 1 ]; then
          echo "  Vaults on your account:"
          for i in "${!VAULTS[@]}"; do echo "    $((i + 1))) ${VAULTS[$i]}"; done
          while [ -z "$VN" ]; do
            read -rp "  Which one? [1-${#VAULTS[@]}] " PICK
            if [[ "$PICK" =~ ^[0-9]+$ ]] && [ "$PICK" -ge 1 ] && [ "$PICK" -le "${#VAULTS[@]}" ]; then
              VN="${VAULTS[$((PICK - 1))]}"
            fi
          done
        else
          echo "  Couldn't list the vaults on your account, so type the name instead."
          read -rp "  Exact vault name on your Obsidian Sync account: " VN
        fi
        [ -n "$VN" ] || die "vault name is required"
        set_env VAULT_NAME "$VN" force
        source .env
      fi

      # Set up the vault link here, not in the long-running container, so a
      # wrong encryption password gets asked again instead of leaving the
      # container restarting forever.
      if docker compose run --rm -T obsidian-sync is-configured </dev/null >/dev/null 2>&1; then
        ok "sync for '$VAULT_NAME' is already set up, reusing it"
      else
        VP="${VAULT_PASSWORD:-}"
        if [ -z "$VP" ]; then
          read -rsp "  End-to-end encryption password (blank if you didn't turn that on): " VP; echo
        fi
        # Passed by name (-e VAULT_PASSWORD), so it never shows up in `ps`.
        until OUT=$(VAULT_PASSWORD="$VP" docker compose run --rm -T -e VAULT_PASSWORD obsidian-sync setup </dev/null 2>&1); do
          case "$OUT" in
            *"Wrong vault key"*)       echo "  That encryption password isn't right for '$VAULT_NAME'." ;;
            *"Password not provided"*) echo "  '$VAULT_NAME' has end-to-end encryption, so it needs its password." ;;
            *)
              echo "$OUT" | grep -v '^ *at \|Container ' | tail -5
              echo "  Setting up sync didn't work (see above)."
              read -rp "  Try again? [Y/n] " AGAIN
              case "$AGAIN" in [nN]*) exit 1 ;; esac
              continue ;;
          esac
          echo "  (It's the vault's encryption password, not your Obsidian account password.)"
          read -rsp "  Encryption password (blank to stop): " VP; echo
          [ -n "$VP" ] || { echo "  Nothing else has been changed. Re-run ./install.sh when ready."; exit 1; }
        done
        set_env VAULT_PASSWORD "$VP" force
        ok "connected to '$VAULT_NAME'"
      fi

      docker compose up -d
    )
    ok "Official Obsidian Sync is up — syncing into ${VAULT_HOST_PATH:-./vault}"
    ;;
  3)
    say "Self-hosted LiveSync"
    ( cd sync/self-hosted-livesync
      if [ ! -f .env ]; then cp .env.example .env; fi
      # Propagate the root's prefix — this is a separate compose project
      # with its own .env, so it isn't inherited automatically.
      [ -n "${INSTANCE_PREFIX:-}" ] && set_env INSTANCE_PREFIX "$INSTANCE_PREFIX"
      # shellcheck disable=SC1091
      source .env
      if [ -z "${COUCHDB_PASSWORD:-}" ] || [ "$COUCHDB_PASSWORD" = "change_me_use_a_strong_password" ]; then
        PW="$(openssl rand -hex 20)"
        sed -i.bak "s#^COUCHDB_PASSWORD=.*#COUCHDB_PASSWORD=${PW}#" .env && rm -f .env.bak
        ok "generated COUCHDB_PASSWORD"
      fi
      docker compose up -d
    )
    LIVESYNC_PORT="$(grep '^COUCHDB_PORT=' sync/self-hosted-livesync/.env | cut -d= -f2-)"
    ok "CouchDB is up on http://localhost:${LIVESYNC_PORT:-5984}"
    echo "  Point the Self-hosted LiveSync plugin (in Obsidian, on each of your devices) at it —"
    echo "  URI/username/password are in sync/self-hosted-livesync/.env."
    echo "  A headless worker also runs alongside CouchDB, materializing whatever your devices"
    echo "  sync as real files at ${VAULT_HOST_PATH:-./vault} — that's what obsidian-api/obsidian-mcp read."
    ;;
  4)
    say "Git"
    ( cd sync/git-sync
      if [ ! -f .env ]; then cp .env.example .env; fi
      [ -n "${INSTANCE_PREFIX:-}" ] && set_env INSTANCE_PREFIX "$INSTANCE_PREFIX"
      # shellcheck disable=SC1091
      source .env

      if [ -z "${GIT_REPO_URL:-}" ]; then
        echo "  Your vault repo. SSH (e.g. git@github.com:you/vault.git) is recommended —"
        echo "  a deploy key is generated for you. HTTPS works too, with a token in the URL."
        read -rp "  Repo URL: " REPO
        [ -n "$REPO" ] || die "a repo URL is required"
        set_env GIT_REPO_URL "$REPO"
        source .env
      fi

      mkdir -p ssh
      case "$GIT_REPO_URL" in
        http://*|https://*|file://*) ;;
        *)
          if [ ! -f ssh/id_ed25519 ]; then
            command -v ssh-keygen >/dev/null 2>&1 || die "ssh-keygen is required to create a deploy key"
            ssh-keygen -q -t ed25519 -N "" -f ssh/id_ed25519 -C "obsidian-server-stack"
            echo
            echo "  Add this public key to your repo as a deploy key WITH WRITE ACCESS"
            echo "  (GitHub: repo → Settings → Deploy keys → Add deploy key → tick 'Allow write access'):"
            echo
            echo "    $(cat ssh/id_ed25519.pub)"
            echo
            read -rp "  Press Enter once it's added... " _
          else
            ok "reusing existing deploy key (ssh/id_ed25519.pub)"
          fi
          ;;
      esac
      chown -R 1000:1000 ssh 2>/dev/null || true
      chmod 600 ssh/id_ed25519 2>/dev/null || true

      docker compose up -d --build
    )
    ok "Git sync is up — syncing ${VAULT_HOST_PATH:-./vault} every ${SYNC_INTERVAL:-60}s"
    echo "  Install the obsidian-git plugin on your devices, pointed at the same repo."
    echo "  Watch it with: cd sync/git-sync && docker compose logs -f"
    ;;
  5)
    say "Existing LiveSync server"
    ( cd sync/livesync-existing
      if [ ! -f .env ]; then cp .env.example .env; fi
      [ -n "${INSTANCE_PREFIX:-}" ] && set_env INSTANCE_PREFIX "$INSTANCE_PREFIX"

      # </dev/null: `docker compose run` otherwise reads stdin and swallows
      # whatever the user types next (found by testing with piped input).
      if docker compose run --rm -T --entrypoint sh vault-sync -c 'test -f /data/.livesync/settings.json' </dev/null >/dev/null 2>&1; then
        ok "already connected, reusing existing settings"
      else
        echo "  In Obsidian on a device that already syncs: Settings → Self-hosted LiveSync"
        echo "  → Setup → Copy the setup URI. It asks you to choose a passphrase for it."
        echo
        read -rp "  Setup URI: " SETUP_URI
        [ -n "$SETUP_URI" ] || die "a Setup URI is required"
        read -rsp "  Its passphrase (hidden): " SETUP_PASS; echo
        [ -n "$SETUP_PASS" ] || die "the Setup URI passphrase is required"
        # Used once and not stored: the URI goes in as an env var for this run
        # only, the passphrase on stdin. The CLI keeps the decoded settings
        # in its own data volume.
        if ! printf '%s\n' "$SETUP_PASS" | docker compose run --rm -T -e SETUP_URI="$SETUP_URI" vault-sync setup >/dev/null 2>&1; then
          die "couldn't apply that Setup URI — check the URI and passphrase, then re-run ./install.sh"
        fi
        unset SETUP_URI SETUP_PASS
        ok "settings imported from the Setup URI"
      fi

      docker compose up -d
    )
    ok "Connected to your existing LiveSync server — syncing into ${VAULT_HOST_PATH:-./vault}"
    echo "  Watch it with: cd sync/livesync-existing && docker compose logs -f"
    ;;
  *)
    ok "skipping sync setup"
    ;;
esac

say "Done"
echo "  MCP endpoint:  http://localhost:${MCP_PORT:-7002}/mcp"
echo "  Bearer token:  see MCP_BEARER_TOKEN in .env"
