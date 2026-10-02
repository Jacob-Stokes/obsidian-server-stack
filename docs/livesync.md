# Self-hosted LiveSync

Self-hosted LiveSync vaults share one CouchDB server, with a database per vault. Each vault is end-to-end encrypted, with obfuscated file paths, so CouchDB only holds ciphertext.

Devices are set up with a Setup URI, made by the LiveSync project's own generator. Adding the vault prints one, with its passphrase, and `obsidian-stack setup-uri <id>` prints another at any time. The URIs don't expire, any number of devices can use the same one, and every URI for a vault carries the same encryption passphrase and settings, so a device added months later joins the same vault. On each device: install the plugin, choose "Use the copied setup URI" (or open the URI on the device), and enter the passphrase. Devices sync every 60 seconds by default; switching the plugin's sync mode to LiveSync makes it real time. The server's own copy always runs in LiveSync mode, so MCP writes reach CouchDB within seconds.

When a device's plugin asks, it should **fetch from the server**, not rebuild or overwrite it: the server's copy has already set the vault up, so no device is ever the first. A rebuild locks the server's copy out; `obsidian-stack status` then says so, and `obsidian-stack resync <id>` fetches the vault again (the server's previous files are kept aside).

## Versions

Devices update the LiveSync plugin on their own, and a newer plugin can upgrade a vault's database to a format an older client can't read. So the server's client is built from the same LiveSync release's source, not from LiveSync's published images, which can trail the plugin by weeks. [Renovate](https://docs.renovatebot.com) opens a pull request for each new LiveSync release, moving the client and the Setup URI generator together, and [`scripts/test-livesync.sh`](https://github.com/Jacob-Stokes/obsidian-server-stack/blob/main/scripts/test-livesync.sh) tests it in CI: a device joins with a Setup URI, notes sync both ways, and `resync` recovers a locked vault. `obsidian-stack update` brings a merged bump to an install.

## Phones and HTTPS

Obsidian on iOS and Android only connects to servers over `https://`. Both operating systems block plain `http://` from the app, and the block applies to every network, including a Tailscale tailnet or a home Wi-Fi network. Obsidian desktop accepts `http://`.

This matters only for self-hosted LiveSync, the one source where devices connect to this server:

| Source | What devices connect to | HTTPS needed on this server |
|---|---|---|
| Self-hosted LiveSync | This server's CouchDB (port 5984) | Yes, for phones |
| Existing LiveSync server | That server | No (that server's own address) |
| Official Obsidian Sync | Obsidian's servers, already HTTPS | No |
| Git | The git host, already HTTPS or SSH | No |

To give CouchDB an HTTPS address, `sync/couchdb` has optional profiles for [Tailscale](https://tailscale.com) (an `https://<name>.<tailnet>.ts.net` address, private to the tailnet), [Caddy](https://caddyserver.com) (a domain with automatic certificates) and [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (a domain, no open ports); see [sync/couchdb](https://github.com/Jacob-Stokes/obsidian-server-stack/blob/main/sync/couchdb/README.md). An existing reverse proxy pointed at port 5984 works too. The address devices use is asked for when the first self-hosted LiveSync vault is added and goes into each Setup URI; `obsidian-stack setup-uri <id> --url` changes it and prints a new URI.
