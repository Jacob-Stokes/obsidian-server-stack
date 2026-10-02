#!/usr/bin/env bash
# End-to-end test of self-hosted LiveSync, as CI runs it on every change to
# the LiveSync version (Renovate's pull requests) and to the stack's LiveSync
# code. Needs Docker and root (or sudo); leaves nothing behind.
#
#   1. a throwaway install (prefix ci-) with a self-hosted LiveSync vault
#   2. a simulated device: the same LiveSync client, set up from the vault's
#      Setup URI, as a device's plugin would be
#   3. a note each way: device → server, server → device
#   4. the device locks the database, as a rebuild does; status must say so,
#      and `obsidian-stack resync` must get the server syncing again
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
STACK="$WORK/stack"
DEVICE="$WORK/device"
PREFIX=ci-
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }
wait_for() {
  local what="$1" n="$2"; shift 2
  for _ in $(seq 1 "$n"); do "$@" && return 0; sleep 2; done
  echo "--- status:"; (cd "$STACK" && ./obsidian-stack status --json) || true
  echo "--- worker log:"; docker logs --tail 15 "${PREFIX}obsidian-notes-livesync" 2>&1 || true
  fail "$what"
}

cleanup() {
  docker rm -f "${PREFIX}device" >/dev/null 2>&1 || true
  [ -x "$STACK/obsidian-stack" ] && "$STACK/obsidian-stack" uninstall --yes >/dev/null 2>&1 || true
  docker volume ls -q | grep "^${PREFIX}" | xargs -r docker volume rm >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== install (prefix $PREFIX) with a self-hosted LiveSync vault"
mkdir -p "$STACK"
(cd "$SRC" && git ls-files -z | xargs -0 -I{} cp --parents {} "$STACK/")
cp "$SRC/obsidian-stack" "$STACK/"   # also untracked edits, when run by hand
cd "$STACK"
cp .env.example .env
sed -i "s/^INSTANCE_PREFIX=.*/INSTANCE_PREFIX=$PREFIX/; s/^MCP_PORT=.*/MCP_PORT=7952/" .env
cp sync/couchdb/.env.example sync/couchdb/.env
sed -i 's/^COUCHDB_PORT=.*/COUCHDB_PORT="127.0.0.1:5995"/' sync/couchdb/.env
./obsidian-stack install --yes --name Notes --source livesync \
  --device-url "http://${PREFIX}obsidian-couchdb:5984" --app no </dev/null >"$WORK/install.log" 2>&1 \
  || { tail -30 "$WORK/install.log"; fail "install"; }
pass "install"

CLIENT="$(./obsidian-stack status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["vaults"][0]["sync"]["state"])')"
[ "$CLIENT" = running ] || fail "the vault's worker is running (got: $CLIENT)"
IMAGE="$(docker inspect -f '{{.Config.Image}}' "${PREFIX}obsidian-notes-livesync")"
pass "worker running ($IMAGE)"
services="$(docker compose ps --services | sort | paste -sd ' ' -)"
for svc in obsidian-api obsidian-mcp couchdb notes-sync; do
  grep -qw "$svc" <<< "$services" || fail "one compose project runs everything (missing $svc in: $services)"
done
[ -z "$(docker volume ls -q | grep "^${PREFIX}obsidian-" || true)" ] || fail "no Docker volumes: data stays in the install folder"
pass "one compose project: $services"

echo "== a device joins with the Setup URI"
SETUP="$(./obsidian-stack setup-uri notes --json </dev/null)"
URI="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["uri"])' "$SETUP")"
PASSPHRASE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["passphrase"])' "$SETUP")"
mkdir -p "$DEVICE/vault" "$DEVICE/data"
chown -R 1000:1000 "$DEVICE"
printf '%s\n' "$PASSPHRASE" | docker run --rm -i -u 1000:1000 -v "$DEVICE/data:/data" -e LIVESYNC_DB_PATH=/data \
  --entrypoint livesync-cli "$IMAGE" --settings /data/.livesync/settings.json setup "$URI" >/dev/null \
  || fail "the device imports the Setup URI"
# a device left on LiveSync's default periodic sync would take a minute a note
docker run --rm -u 1000:1000 -v "$DEVICE/data:/data" --entrypoint node "$IMAGE" -e '
  const fs = require("fs"), f = "/data/.livesync/settings.json", s = JSON.parse(fs.readFileSync(f));
  Object.assign(s, { liveSync: true, periodicReplication: false, batchSave: false });
  fs.writeFileSync(f, JSON.stringify(s));'
docker run -d --name "${PREFIX}device" --network "${PREFIX}obsidian-livesync" -u 1000:1000 \
  -v "$DEVICE/data:/data" -v "$DEVICE/vault:/vault" -e LIVESYNC_DB_PATH=/data \
  --entrypoint livesync-cli "$IMAGE" --settings /data/.livesync/settings.json --vault /vault daemon >/dev/null
wait_for "the device starts syncing" 60 sh -c "docker logs ${PREFIX}device 2>&1 | grep -q 'LiveSync active'"
pass "device set up from the Setup URI"

echo "== notes both ways"
echo "written on the device" > "$DEVICE/vault/From device.md"; chown 1000:1000 "$DEVICE/vault/From device.md"
wait_for "a device note reaches the server" 45 test -f "vaults/notes/From device.md"
pass "device → server"
echo "written on the server" > "vaults/notes/From server.md"; chown 1000:1000 "vaults/notes/From server.md"
wait_for "a server note reaches the device" 45 test -f "$DEVICE/vault/From server.md"
pass "server → device"

echo "== a device locks the database (as a rebuild does)"
docker rm -f "${PREFIX}device" >/dev/null
docker run --rm --network "${PREFIX}obsidian-livesync" -u 1000:1000 -v "$DEVICE/data:/data" -e LIVESYNC_DB_PATH=/data \
  --entrypoint livesync-cli "$IMAGE" --settings /data/.livesync/settings.json lock-remote >/dev/null
./obsidian-stack restart notes </dev/null >/dev/null
problem_reported() { ./obsidian-stack status --json | python3 -c 'import json,sys; sys.exit(0 if "rebuilt" in json.load(sys.stdin)["vaults"][0]["problem"] else 1)'; }
wait_for "status explains the lock" 45 problem_reported
pass "status says a device rebuilt it"
./obsidian-stack resync notes --yes </dev/null >"$WORK/resync.log" 2>&1 || { tail -20 "$WORK/resync.log"; fail "resync"; }
recovered() { ./obsidian-stack status --json | python3 -c 'import json,sys; v=json.load(sys.stdin)["vaults"][0]; sys.exit(0 if v["sync"]["state"]=="running" and not v["problem"] else 1)'; }
wait_for "the worker syncs again after resync" 30 recovered
for f in "From device.md" "From server.md"; do test -f "vaults/notes/$f" || fail "'$f' is back on the server after resync"; done
pass "resync recovered, both notes present"

echo "== all passed"
