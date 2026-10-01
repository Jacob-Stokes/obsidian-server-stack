# Third-party notices

## sync/couchdb/

`couchdb`, `couchdb-init`, and the `caddy`/`tailscale`/`cloudflare` profiles
are vendored from
[vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync)
(`docker/` folder), MIT licensed. File paths were adjusted to fit this
repo's layout, the per-vault database is created by `obsidian-stack` rather than
`couchdb-init`, and `couchdb-init`'s readiness check authenticates so it can
be re-run once authentication is on. The CouchDB configuration is otherwise
unchanged.

## sync/livesync/

Original compose file and entrypoint script (no Dockerfile). The image they
run,
[`ghcr.io/vrtmrz/livesync-cli`](https://github.com/vrtmrz/obsidian-livesync/pkgs/container/livesync-cli),
is the same project's own official headless CLI
([`src/apps/cli`](https://github.com/vrtmrz/obsidian-livesync/tree/main/src/apps/cli)
in the same repo, same MIT license), referenced directly rather than
rebuilt, since its authors already publish it.

`obsidian-stack` makes Setup URIs for self-hosted LiveSync vaults with the
same project's generator,
[`utils/flyio/generate_setupuri.ts`](https://github.com/vrtmrz/obsidian-livesync/blob/main/utils/flyio/generate_setupuri.ts)
(MIT), fetched at a pinned commit and run in the official
[`denoland/deno`](https://hub.docker.com/r/denoland/deno) image (MIT) when a
URI is needed. Neither is included in this repository.

## sync/official-obsidian-sync/

Original Dockerfile and entrypoint. The image installs
[`obsidian-headless`](https://www.npmjs.com/package/obsidian-headless)
([source](https://github.com/obsidianmd/obsidian-headless)) — Obsidian's own official CLI for their paid Sync
product — straight from npm at build time, the same distribution channel
Obsidian themselves publish it through.

Obsidian and Obsidian Sync are products of Dynalist Inc. They are not
open-source software and are not distributed by this repository. The
`obsidian-headless` package is published as `"license": "UNLICENSED"` on
npm (proprietary). It is installed from npm, Obsidian's own distribution
channel, at build time and is never redistributed by this repository. Use
of Obsidian's services remains subject to Obsidian's terms and any
required paid plan.

## sync/git-sync/

Original Dockerfile and entrypoint script. The image installs `git` and
`openssh-client` from Alpine's package repository at build time, the same
as any OS package; nothing from those projects is vendored here.

## Everything else

`services/obsidian-mcp`, `services/obsidian-api`, `obsidian-stack` and `install.sh` are
original code, MIT licensed
(see [LICENSE](LICENSE)). Direct dependency licenses, checked against the
npm registry: `services/obsidian-mcp` uses
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (MIT),
[`zod`](https://www.npmjs.com/package/zod) (MIT),
[`jose`](https://www.npmjs.com/package/jose) (MIT), and
[`yaml`](https://www.npmjs.com/package/yaml) (ISC — permissive, not MIT,
functionally equivalent). `services/obsidian-api` uses
[`hono`](https://www.npmjs.com/package/hono) and
[`@hono/node-server`](https://www.npmjs.com/package/@hono/node-server) (MIT).
