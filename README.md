<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.gif">
    <img src="assets/logo-light.gif" alt="Obsidian Server Stack logo" width="90">
  </picture>
</p>

<h1 align="center">Obsidian Server Stack</h1>

<p align="center">An Obsidian vault on a server, synced across devices and reachable over MCP.</p>

<p align="center">
  <a href="https://github.com/Jacob-Stokes/obsidian-server-stack/actions/workflows/build.yml"><img src="https://github.com/Jacob-Stokes/obsidian-server-stack/actions/workflows/build.yml/badge.svg" alt="Build status"></a>
  <a href="https://jacob-stokes.github.io/obsidian-server-stack/"><img src="https://img.shields.io/badge/docs-online-7c4dff" alt="Documentation"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Jacob-Stokes/obsidian-server-stack" alt="MIT license"></a>
</p>

Most Obsidian MCP servers run on a personal computer, and many also need the Obsidian app open, so the vault is unreachable whenever that machine is off. This stack keeps copies of one or more vaults on an always-on server instead, each synced with other devices in its own way (self-hosted LiveSync, Official Obsidian Sync or git) and all reachable by any MCP client over HTTP. It runs headless: a few small containers, about 230 MB of RAM, and the notes as plain markdown files.

<p align="center">
  <img src="assets/installer.gif" alt="obsidian-stack installing the stack and adding a self-hosted LiveSync vault, sped up" width="720">
</p>

## Install

Two ways, running the same containers. Requires Linux with Docker (Compose v2).

**Installer**, for most setups: asks a few questions, adds vaults, makes Setup URIs for devices, and leaves an `obsidian-stack` command for managing it.

```bash
git clone https://github.com/Jacob-Stokes/obsidian-server-stack.git
cd obsidian-server-stack
./install.sh
```

**Docker Compose**, for servers where everything is a compose file: [`examples/compose.yml`](examples/compose.yml) builds the services straight from this repository, with no installer. See [Docker Compose](https://jacob-stokes.github.io/obsidian-server-stack/compose/).

The MCP endpoint is then `http://localhost:7002/mcp`, with its bearer token in `.env`.

## Documentation

**[jacob-stokes.github.io/obsidian-server-stack](https://jacob-stokes.github.io/obsidian-server-stack/)**

- [How it works](https://jacob-stokes.github.io/obsidian-server-stack/how-it-works/): vaults, containers and sync sources
- [Self-hosted LiveSync](https://jacob-stokes.github.io/obsidian-server-stack/livesync/): devices, Setup URIs, HTTPS for phones
- [Managing with obsidian-stack](https://jacob-stokes.github.io/obsidian-server-stack/managing/) and [connecting to the MCP](https://jacob-stokes.github.io/obsidian-server-stack/mcp/)
- Optional: the [Obsidian app](https://jacob-stokes.github.io/obsidian-server-stack/obsidian-app/) for plugins, Bases and screenshots, and [managing the stack from AI tools](https://jacob-stokes.github.io/obsidian-server-stack/ai-management/)

## License

MIT. The CouchDB setup in `sync/couchdb` is adapted from [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync), also MIT. Obsidian's sync client, [obsidian-headless](https://www.npmjs.com/package/obsidian-headless), is installed from npm when the image is built and isn't included in this repo. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
