#!/usr/bin/env bash
# Installer for obsidian-server-stack. Brings up the core stack (obsidian-api +
# obsidian-mcp), then lets you add or remove vaults, each with its own sync
# source. Safe to re-run: it keeps your .env, vaults and sync settings, and
# makes sure every vault's sync is running.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$(pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }
# read that treats end of input as an empty answer instead of exiting (set -e)
ask() { read -rp "$1" "$2" || printf -v "$2" '%s' ""; }
ask_secret() { read -rsp "$1" "$2" || printf -v "$2" '%s' ""; echo; }

command -v docker >/dev/null 2>&1 || die "docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "docker compose (v2 plugin) is required."
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."
command -v curl >/dev/null 2>&1 || die "curl is required."

set_env() {
  # set_env FILE KEY VALUE [force] — replaces KEY= in FILE, only if currently
  # empty unless "force" is passed. Always quotes the written value: these
  # files get `source`d, so an unquoted value with a space breaks them — e.g.
  # a vault name like "My Vault" parses as VAULT_NAME=My, then tries to run
  # "Vault" as a command. Found by actually entering one, not by inspection.
  local file="$1" key="$2" val="$3" force="${4:-}"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    if [ -n "$force" ] || [ -z "$(grep "^${key}=" "$file" | cut -d= -f2-)" ]; then
      local tmp; tmp="$(mktemp)"
      # via ENVIRON, not awk -v, which would mangle backslashes in the value
      K="$key" V="\"$val\"" awk 'index($0, ENVIRON["K"]"=")==1 { print ENVIRON["K"]"="ENVIRON["V"]; next } { print }' "$file" > "$tmp"
      cat "$tmp" > "$file" && rm -f "$tmp"
    fi
  else
    echo "${key}=\"${val}\"" >> "$file"
  fi
}

# --- core stack --------------------------------------------------------------

say "Setting up the core stack"

# The 0.1 layout kept a single vault in ./vault. Adopting it automatically
# would mean stopping and rewiring its sync containers, so ask instead.
if [ -d vault ] && [ -n "$(ls -A vault 2>/dev/null)" ] && [ ! -f vaults/.registry.json ]; then
  die "this looks like a 0.1 install with notes in ./vault. Version 0.2 keeps
  each vault in vaults/<id>/. See \"Upgrading from 0.1\" in README.md, then
  re-run this script."
fi

if [ ! -f .env ]; then
  cp .env.example .env
  ok "created .env from .env.example"
else
  ok ".env already exists, leaving it alone"
fi

# shellcheck disable=SC1091
source .env 2>/dev/null || true
if [ -z "${API_KEY:-}" ]; then
  set_env .env API_KEY "$(openssl rand -hex 32)"
  ok "generated API_KEY"
fi
if [ -z "${MCP_BEARER_TOKEN:-}" ]; then
  set_env .env MCP_BEARER_TOKEN "$(openssl rand -hex 32)"
  ok "generated MCP_BEARER_TOKEN"
fi
# shellcheck disable=SC1091
source .env
P="${INSTANCE_PREFIX:-}"

# Catch a name collision before docker does — its error for this is a lot
# less clear than "these containers already exist, set INSTANCE_PREFIX."
# Only a *foreign* collision blocks — a container this same project already
# created is fine and must stay re-runnable.
PROJECT="${P}obsidian-server-stack"
FOREIGN=""
for n in "${P}obsidian-api" "${P}obsidian-mcp"; do
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

# obsidian-api and every sync container run as uid/gid 1000. If the vault
# folders end up owned by someone else (e.g. you ran this as root), every
# write fails with EACCES. Found by actually testing this, not guessing.
mkdir -p vaults state
chmod 700 state
# own [-R] PATH — chown to the containers' uid/gid
own() {
  if ! chown "${@:1:$#-1}" 1000:1000 "${@: -1}" 2>/dev/null; then
    echo "  Warning: couldn't chown ${*: -1} to 1000:1000 (not root?). If writes fail"
    echo "  later, run that chown yourself."
  fi
}
own vaults

say "Starting obsidian-api and obsidian-mcp"
# --remove-orphans cleans up containers from older versions of this stack.
docker compose up -d --build --remove-orphans

# The vault registry is managed by the same code the API reads it with, run
# inside the API image, so the host needs nothing beyond Docker.
reg() { docker run --rm -v "$ROOT/vaults:/vaults" -w /app --entrypoint node "${P}obsidian-api:local" registry.mjs /vaults "$@" </dev/null; }
reg init

printf '  waiting for obsidian-mcp'
UP=""
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:${MCP_PORT:-7002}/health" >/dev/null 2>&1; then UP=1; break; fi
  printf '.'
  sleep 1
done
echo
[ -n "$UP" ] || die "obsidian-mcp didn't come up — check 'docker compose logs obsidian-mcp'"
ok "obsidian-mcp is up on http://localhost:${MCP_PORT:-7002}/mcp"

# --- per-vault sync ----------------------------------------------------------
# Each vault's sync runs as its own compose project, <prefix>obsidian-<id>,
# from one of the sync/ folders, with its settings in state/<id>/sync.env.

sync_dir() {
  case "$1" in
    livesync|livesync-existing) echo livesync ;;
    official) echo official-obsidian-sync ;;
    git) echo git-sync ;;
    *) echo "" ;;
  esac
}

source_label() {
  case "$1" in
    livesync) echo "self-hosted LiveSync" ;;
    livesync-existing) echo "existing LiveSync server" ;;
    official) echo "Official Obsidian Sync" ;;
    git) echo "git" ;;
    *) echo "no sync" ;;
  esac
}

# vc <id> <source> <compose args...>
vc() {
  local id="$1" dir; dir="$(sync_dir "$2")"; shift 2
  docker compose -p "${P}obsidian-${id}" --project-directory "sync/$dir" \
    -f "sync/$dir/docker-compose.yml" --env-file "state/$id/sync.env" "$@"
}

new_state() {
  local id="$1"
  mkdir -p "state/$id"
  chmod 700 "state/$id"
  local f="state/$id/sync.env"
  : > "$f"
  chmod 600 "$f"
  set_env "$f" INSTANCE_PREFIX "$P"
  set_env "$f" VAULT_ID "$id"
  set_env "$f" VAULT_DIR "$ROOT/vaults/$id"
  set_env "$f" STATE_DIR "$ROOT/state/$id"
}

ensure_livesync_network() {
  docker network inspect "${P}obsidian-livesync" >/dev/null 2>&1 \
    || docker network create "${P}obsidian-livesync" >/dev/null
}

COUCHDB_READY=""
ensure_couchdb() {
  [ -n "$COUCHDB_READY" ] && return 0
  ( cd sync/couchdb
    [ -f .env ] || cp .env.example .env
    chmod 600 .env
    set_env .env INSTANCE_PREFIX "$P" force
    # shellcheck disable=SC1091
    source .env
    if [ -z "${COUCHDB_PASSWORD:-}" ]; then
      set_env .env COUCHDB_PASSWORD "$(openssl rand -hex 20)"
      ok "generated the CouchDB password (sync/couchdb/.env)"
    fi
  )
  ensure_livesync_network
  ( cd sync/couchdb && docker compose up -d )
  printf '  waiting for CouchDB'
  for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "${P}obsidian-couchdb" 2>/dev/null)" = healthy ] && break
    printf '.'; sleep 2
  done
  # couchdb-init turns on auth and CORS; wait for it so a device can't
  # connect to a half-configured server.
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "${P}obsidian-couchdb-init" 2>/dev/null)" = "exited 0" ] && break
    printf '.'; sleep 2
  done
  echo
  [ "$(docker inspect -f '{{.State.Health.Status}}' "${P}obsidian-couchdb" 2>/dev/null)" = healthy ] \
    || die "CouchDB didn't come up — check: cd sync/couchdb && docker compose logs"
  ok "CouchDB is up on port $(grep '^COUCHDB_PORT=' sync/couchdb/.env | cut -d= -f2- | tr -d '"')"
  COUCHDB_READY=1
}

couchdb_env() { grep "^$1=" sync/couchdb/.env | cut -d= -f2- | tr -d '"'; }

create_db() {
  local code
  code="$(docker exec "${P}obsidian-couchdb" curl -s -o /dev/null -w '%{http_code}' \
    -u "$(couchdb_env COUCHDB_USER):$(couchdb_env COUCHDB_PASSWORD)" -X PUT "http://127.0.0.1:5984/$1")"
  case "$code" in
    201|202) ok "created CouchDB database '$1'" ;;
    412) ok "CouchDB database '$1' already exists, reusing it" ;;
    *) die "couldn't create CouchDB database '$1' (HTTP $code)" ;;
  esac
}

setup_none() {
  ok "no sync — put files in vaults/$1/ however you like (rsync, Syncthing, ...)"
}

setup_livesync() {
  local id="$1" f="state/$1/sync.env" pass
  ensure_couchdb
  create_db "$id"
  set_env "$f" COUCHDB_URI "http://${P}obsidian-couchdb:5984"
  set_env "$f" COUCHDB_USER "$(couchdb_env COUCHDB_USER)"
  set_env "$f" COUCHDB_PASSWORD "$(couchdb_env COUCHDB_PASSWORD)"
  set_env "$f" COUCHDB_DATABASE "$id"
  echo "  If you'll turn on end-to-end encryption in the LiveSync plugin for this"
  echo "  vault, enter the passphrase you'll use there (blank for none)."
  ask_secret "  Encryption passphrase: " pass
  [ -n "$pass" ] && set_env "$f" VAULT_ENCRYPT_PASSPHRASE "$pass"
  vc "$id" livesync up -d
  ok "LiveSync worker is up"
  echo "  On each device, point the Self-hosted LiveSync plugin at:"
  echo "    URI:       http://<this server>:$(couchdb_env COUCHDB_PORT)"
  echo "    Username:  $(couchdb_env COUCHDB_USER)"
  echo "    Password:  COUCHDB_PASSWORD in sync/couchdb/.env"
  echo "    Database:  $id"
  echo "  (Obsidian mobile needs HTTPS — see sync/couchdb/README.md.)"
}

setup_livesync_existing() {
  local id="$1" uri pass
  ensure_livesync_network
  # </dev/null: `docker compose run` otherwise reads stdin and swallows
  # whatever the user types next (found by testing with piped input).
  if vc "$id" livesync-existing run --rm -T --entrypoint sh livesync -c 'test -f /data/.livesync/settings.json' </dev/null >/dev/null 2>&1; then
    ok "already connected, reusing existing settings"
  else
    echo "  In Obsidian on a device that already syncs: Settings → Self-hosted LiveSync"
    echo "  → Setup → Copy the setup URI. It asks you to choose a passphrase for it."
    echo
    ask "  Setup URI: " uri
    [ -n "$uri" ] || die "a Setup URI is required"
    ask_secret "  Its passphrase (hidden): " pass
    [ -n "$pass" ] || die "the Setup URI passphrase is required"
    # Used once and not stored: the URI goes in as an env var for this run
    # only, the passphrase on stdin. The CLI keeps the decoded settings in
    # the vault's own data volume.
    if ! printf '%s\n' "$pass" | vc "$id" livesync-existing run --rm -T -e SETUP_URI="$uri" livesync setup >/dev/null 2>&1; then
      die "couldn't apply that Setup URI — check the URI and passphrase, then re-run ./install.sh"
    fi
    ok "settings imported from the Setup URI"
  fi
  vc "$id" livesync-existing up -d
  ok "connected to your existing LiveSync server"
}

setup_official() {
  local id="$1" f="state/$1/sync.env" other token="" vn vp out again pick
  local data="state/$id/official" tokfile="state/$id/official/config/obsidian-headless/auth_token"
  mkdir -p "$data"
  own -R "$data"
  set_env "$f" DEVICE_NAME "obsidian-server-stack"
  vc "$id" official build -q

  # Reuse a login from another Official Sync vault on this server, if any.
  for other in state/*/official/config/obsidian-headless/auth_token; do
    [ -s "$other" ] && [ "$other" != "$tokfile" ] || continue
    ask "  Use the Obsidian account already signed in on this server? [Y/n] " again
    case "$again" in [nN]*) ;; *)
      mkdir -p "$(dirname "$tokfile")"
      cp "$other" "$tokfile"
      own -R "$data"
      token="$(cat "$tokfile")"
      ok "reusing that login"
    ;; esac
    break
  done

  if [ -z "$token" ]; then
    # The one step that can't be scripted: your Obsidian email, password and
    # MFA code have to be typed by you — a script that could do this for you
    # would need your raw account password sitting in a file.
    say "Logging in to Obsidian (interactive)"
    until vc "$id" official run --rm -it obsidian-sync get-token; do
      echo
      echo "  Login didn't work (the error above says why)."
      ask "  Try again? [Y/n] " again
      case "$again" in [nN]*) die "Obsidian login cancelled" ;; esac
    done
    if [ -s "$tokfile" ]; then
      token="$(cat "$tokfile")"
    else
      ask "  Paste the OBSIDIAN_AUTH_TOKEN value printed above: " token
    fi
    [ -n "$token" ] || die "no token entered"
  fi
  set_env "$f" OBSIDIAN_AUTH_TOKEN "$token" force

  # Offer the vaults on the account; fall back to typing the name.
  local remote=()
  while IFS= read -r vn; do [ -n "$vn" ] && remote+=("$vn"); done < <(
    vc "$id" official run --rm -T obsidian-sync list-vaults </dev/null 2>/dev/null || true)
  vn=""
  if [ "${#remote[@]}" -eq 1 ]; then
    vn="${remote[0]}"
    ok "found one vault on your account: $vn"
  elif [ "${#remote[@]}" -gt 1 ]; then
    echo "  Vaults on your account:"
    for i in "${!remote[@]}"; do echo "    $((i + 1))) ${remote[$i]}"; done
    while [ -z "$vn" ]; do
      ask "  Which one? [1-${#remote[@]}] " pick
      if [[ "$pick" =~ ^[0-9]+$ ]] && [ "$pick" -ge 1 ] && [ "$pick" -le "${#remote[@]}" ]; then
        vn="${remote[$((pick - 1))]}"
      fi
    done
  else
    echo "  Couldn't list the vaults on your account, so type the name instead."
    ask "  Exact vault name on your Obsidian Sync account: " vn
  fi
  [ -n "$vn" ] || die "vault name is required"
  set_env "$f" VAULT_NAME "$vn" force

  # Link the vault here, not in the long-running container, so a wrong
  # encryption password gets asked again instead of a restart loop.
  if vc "$id" official run --rm -T obsidian-sync is-configured </dev/null >/dev/null 2>&1; then
    ok "sync for '$vn' is already set up, reusing it"
  else
    ask_secret "  End-to-end encryption password (blank if you didn't turn that on): " vp
    # Passed by name (-e VAULT_PASSWORD), so it never shows up in `ps`.
    until out=$(VAULT_PASSWORD="$vp" vc "$id" official run --rm -T -e VAULT_PASSWORD obsidian-sync setup </dev/null 2>&1); do
      case "$out" in
        *"Wrong vault key"*)       echo "  That encryption password isn't right for '$vn'." ;;
        *"Password not provided"*) echo "  '$vn' has end-to-end encryption, so it needs its password." ;;
        *)
          echo "$out" | grep -v '^ *at \|Container ' | tail -5
          echo "  Setting up sync didn't work (see above)."
          ask "  Try again? [Y/n] " again
          case "$again" in [nN]*) die "Obsidian Sync setup cancelled" ;; esac
          continue ;;
      esac
      echo "  (It's the vault's encryption password, not your Obsidian account password.)"
      ask_secret "  Encryption password (blank to stop): " vp
      [ -n "$vp" ] || die "Obsidian Sync setup cancelled"
    done
    set_env "$f" VAULT_PASSWORD "$vp" force
    ok "connected to '$vn'"
  fi
  vc "$id" official up -d
  ok "Official Obsidian Sync is up"
}

setup_git() {
  local id="$1" f="state/$1/sync.env" repo
  echo "  The vault's repo. SSH (e.g. git@github.com:you/vault.git) is recommended —"
  echo "  a deploy key is generated for you. HTTPS works too, with a token in the URL."
  ask "  Repo URL: " repo
  [ -n "$repo" ] || die "a repo URL is required"
  set_env "$f" GIT_REPO_URL "$repo"
  set_env "$f" GIT_BRANCH main
  set_env "$f" SYNC_INTERVAL 60
  local ssh="state/$id/ssh"
  mkdir -p "$ssh"
  case "$repo" in
    http://*|https://*|file://*) ;;
    *)
      if [ ! -f "$ssh/id_ed25519" ]; then
        command -v ssh-keygen >/dev/null 2>&1 || die "ssh-keygen is required to create a deploy key"
        ssh-keygen -q -t ed25519 -N "" -f "$ssh/id_ed25519" -C "obsidian-server-stack/$id"
        echo
        echo "  Add this public key to the repo as a deploy key WITH WRITE ACCESS"
        echo "  (GitHub: repo → Settings → Deploy keys → Add deploy key → tick 'Allow write access'):"
        echo
        echo "    $(cat "$ssh/id_ed25519.pub")"
        echo
        ask "  Press Enter once it's added... " _
      fi
      ;;
  esac
  own -R "$ssh"
  chmod 600 "$ssh/id_ed25519" 2>/dev/null || true
  vc "$id" git up -d --build
  ok "git sync is up — every 60s; devices use the obsidian-git plugin on the same repo"
}

# --- vault menu --------------------------------------------------------------

list_vaults() {
  local lines
  lines="$(reg list)"
  if [ -z "$lines" ]; then
    echo "  (no vaults yet)"
    return
  fi
  while IFS=$'\t' read -r id src name; do
    printf '  %-24s %-20s %s\n' "$id" "$(source_label "$src")" "$name"
  done <<< "$lines"
}

add_vault() {
  local name id choice src
  say "Add a vault"
  ask "  Vault name (e.g. Personal, Work): " name
  [ -n "$name" ] || { echo "  No name entered, nothing added."; return; }
  id="$(reg suggest-id "$name")"
  cat <<'EOF'

  How should this vault's notes get onto this server?

  1) Self-hosted LiveSync
     + Free, real-time, conflicts handled for you; everything on your server
     - Install and configure the Self-hosted LiveSync plugin on each device
     - Runs a CouchDB database here (shared by every LiveSync vault)

  2) Existing LiveSync server
     + Joins a LiveSync setup you already use, as one more device
     + Keeps its encryption and other settings exactly as they are
     - Needs a Setup URI from the plugin (Copy setup URI) and its passphrase
     - Writes go straight into that real vault — consider a test vault first

  3) Official Obsidian Sync
     + Easiest on your devices: just Obsidian's built-in Sync
     + Real-time, conflicts handled for you
     - Needs a paid Obsidian Sync subscription
     - One interactive login during setup (reused for further vaults)

  4) Git
     + Free, full version history, works with any git host
     - Syncs on a timer: changes take minutes, not seconds
     - Editing the same note on two devices between syncs gives a conflict
       (both versions are kept, but you tidy it up by hand)
     - Needs the obsidian-git plugin on each device

  5) None
     + Nothing extra to run
     - You keep vaults/<id>/ up to date yourself (rsync, Syncthing, etc.)

EOF
  ask "  Choice [1]: " choice
  case "${choice:-1}" in
    1) src=livesync ;;
    2) src=livesync-existing ;;
    3) src=official ;;
    4) src=git ;;
    5) src=none ;;
    *) echo "  Not a choice, nothing added."; return ;;
  esac

  mkdir -p "vaults/$id"
  own "vaults/$id"
  new_state "$id"
  case "$src" in
    livesync) setup_livesync "$id" ;;
    livesync-existing) setup_livesync_existing "$id" ;;
    official) setup_official "$id" ;;
    git) setup_git "$id" ;;
    none) setup_none "$id" ;;
  esac
  # Registered last, so a vault only appears to MCP clients once its sync
  # is set up.
  reg add "$id" "$src" "$name"
  ok "added vault '$name' (id: $id) — files in vaults/$id/"
}

remove_vault() {
  local id src confirm
  ask "  Id of the vault to remove: " id
  src="$(reg list | awk -F'\t' -v i="$id" '$1==i { print $2 }')"
  [ -n "$src" ] || { echo "  No vault with id '$id'."; return; }
  ask "  Remove '$id' from the stack? Its files stay in vaults/$id/. [y/N] " confirm
  case "$confirm" in [yY]*) ;; *) echo "  Kept it."; return ;; esac
  if [ -n "$(sync_dir "$src")" ] && [ -f "state/$id/sync.env" ]; then
    vc "$id" "$src" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  reg remove "$id"
  ok "removed '$id'. Its notes are still in vaults/$id/ and its sync settings in"
  echo "    state/$id/ — delete those yourself once you're sure."
}

# On a re-run, bring every vault's sync back up (e.g. after an update).
ensure_all_up() {
  local id src name
  while IFS=$'\t' read -r id src name; do
    [ -n "$id" ] && [ -n "$(sync_dir "$src")" ] || continue
    if [ ! -f "state/$id/sync.env" ]; then
      echo "  Warning: vault '$id' has no sync settings (state/$id/sync.env); its sync isn't running."
      continue
    fi
    case "$src" in
      livesync) ensure_couchdb; vc "$id" "$src" up -d >/dev/null 2>&1 ;;
      livesync-existing) ensure_livesync_network; vc "$id" "$src" up -d >/dev/null 2>&1 ;;
      *) vc "$id" "$src" up -d --build >/dev/null 2>&1 ;;
    esac
    ok "sync running for '$id' ($(source_label "$src"))"
  done <<< "$(reg list)"
}

say "Vaults"
ensure_all_up
if [ -z "$(reg list)" ]; then
  echo "  No vaults yet — let's add one."
  add_vault
fi
while :; do
  say "Vaults"
  list_vaults
  echo
  ask "  a) add a vault   r) remove a vault   d) done [d]: " choice
  case "${choice:-d}" in
    a|A) add_vault ;;
    r|R) remove_vault ;;
    *) break ;;
  esac
done

say "Done"
echo "  MCP endpoint:  http://localhost:${MCP_PORT:-7002}/mcp"
echo "  Bearer token:  see MCP_BEARER_TOKEN in .env"
echo "  MCP clients call obsidian_list_vaults, then pass vault_id to every other tool."
