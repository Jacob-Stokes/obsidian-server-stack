# 001: Managing the stack through the MCP

**Status:** accepted, 2026-10-02

## Context

`obsidian-stack` manages an install from a terminal: adding and removing vaults, restarting sync, turning the Obsidian app on or off, making Setup URIs. The question was whether AI tools connected to the MCP should be able to do the same.

Doing any of this needs Docker, and access to the Docker socket is root-equivalent on the host. Anything that lets an MCP client start containers therefore turns the MCP's credentials into a controlled path to root-level actions.

## Decision

An optional **manager add-on** (`extras/manager`), off by default and turned on with `obsidian-stack manager enable`:

- **A separate container** holds the Docker socket. `obsidian-mcp` never does, so a compromised MCP gets the manager's operations, not Docker.
- **A fixed list of operations**, each run as `obsidian-stack ... --yes` with arguments the manager validates: add, rename and remove vaults; restart sync and read its logs; turn the Obsidian app on or off; make a Setup URI. No raw Docker, shell, uninstall, update or deletion of notes.
- **Its own token**, on the stack's internal network only (no published port). The MCP lists the `obsidian_stack_*` tools only while the token is set.
- **No passwords through a conversation.** Official Sync vaults can only be added by reusing an account already signed in on the server. Joining an existing LiveSync server (which needs another setup's Setup URI and passphrase) stays at the terminal.
- **Removing a vault keeps its notes**, as in the CLI.

To make this possible, every question the CLI asks can be answered by an option, with `--yes` taking defaults for the rest (secrets only from environment variables), and `status`, `vaults` and `setup-uri` have `--json` output.

## Consequences

- Anyone holding the MCP's bearer token or OAuth login can add and remove vaults and start containers through the manager. The MCP should stay private (localhost, a tailnet) or behind OAuth when the manager is on.
- Setup URIs, their passphrases and git deploy keys are returned to the AI client and appear in its conversation.
- A bug in the manager's validation could still allow more than intended; keeping it small, opt-in and limited to `obsidian-stack` subcommands limits that, but can't remove it.
- The manager runs with the install folder mounted at the same path as on the host, so the compose files' relative paths mean the same inside it.

## Alternatives considered

- **Docker socket in `obsidian-mcp`:** simplest, but makes the internet-facing container root-equivalent.
- **A host service (systemd) instead of a container:** keeps Docker access off containers entirely, but adds a host-level install step the stack otherwise avoids.
- **A read-only manager (status and logs only):** safer, but most of the value is in adding vaults and turning the app on.
