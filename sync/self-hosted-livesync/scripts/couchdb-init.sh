#!/bin/sh
# CouchDB initialization for Self-hosted LiveSync — runs once on first boot.
# Vendored from vrtmrz/obsidian-livesync (MIT). See ../../../THIRD_PARTY_NOTICES.md.
set -e

hostname="${COUCHDB_INTERNAL_URL:-http://couchdb:5984}"
username="${COUCHDB_USER:?COUCHDB_USER is required}"
password="${COUCHDB_PASSWORD:?COUCHDB_PASSWORD is required}"
node="${COUCHDB_NODE:-_local}"

echo "==> Waiting for CouchDB at ${hostname} ..."
until curl -sf "${hostname}/_up" 2>/dev/null | grep -q '"status":"ok"'; do
    printf '.'
    sleep 2
done
echo ""
echo "==> CouchDB is up. Initializing..."

curl -sf -X POST "${hostname}/_cluster_setup" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"enable_single_node\",\"username\":\"${username}\",\"password\":\"${password}\",\"bind_address\":\"0.0.0.0\",\"port\":5984,\"singlenode\":true}" \
    --user "${username}:${password}" && echo "[OK] cluster_setup"

curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd/require_valid_user" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] chttpd/require_valid_user"

curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd_auth/require_valid_user" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] chttpd_auth/require_valid_user"

curl -sf -X PUT "${hostname}/_node/${node}/_config/httpd/WWW-Authenticate" \
    -H "Content-Type: application/json" -d '"Basic realm=\"couchdb\""' --user "${username}:${password}" && echo "[OK] httpd/WWW-Authenticate"

curl -sf -X PUT "${hostname}/_node/${node}/_config/httpd/enable_cors" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] httpd/enable_cors"

curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd/enable_cors" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] chttpd/enable_cors"

curl -sf -X PUT "${hostname}/_node/${node}/_config/chttpd/max_http_request_size" \
    -H "Content-Type: application/json" -d '"4294967296"' --user "${username}:${password}" && echo "[OK] chttpd/max_http_request_size"

curl -sf -X PUT "${hostname}/_node/${node}/_config/couchdb/max_document_size" \
    -H "Content-Type: application/json" -d '"50000000"' --user "${username}:${password}" && echo "[OK] couchdb/max_document_size"

curl -sf -X PUT "${hostname}/_node/${node}/_config/cors/credentials" \
    -H "Content-Type: application/json" -d '"true"' --user "${username}:${password}" && echo "[OK] cors/credentials"

curl -sf -X PUT "${hostname}/_node/${node}/_config/cors/origins" \
    -H "Content-Type: application/json" \
    -d '"app://obsidian.md,capacitor://localhost,http://localhost"' \
    --user "${username}:${password}" && echo "[OK] cors/origins"

db="${COUCHDB_DATABASE:-obsidiannotes}"
set +e
status=$(curl -sf -o /dev/null -w "%{http_code}" --user "${username}:${password}" "${hostname}/${db}" 2>/dev/null)
set -e

if [ "$status" = "200" ]; then
    echo "[OK] database '${db}' already exists"
else
    curl -sf -X PUT "${hostname}/${db}" --user "${username}:${password}" && echo "[OK] database '${db}' created" || echo "[WARN] database creation returned non-200 — may already exist"
fi

echo ""
echo "==> CouchDB initialization complete!"
echo "    URL      : ${hostname}"
echo "    Database : ${db}"
echo "    Username : ${username}"
