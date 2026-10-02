# Git sync (one per vault)

Keeps a vault in sync with a git repository. The server commits local changes, merges remote ones and pushes on a timer (every 60 seconds by default). Other devices sync against the same repository with the [obsidian-git](https://github.com/Vinzent03/obsidian-git) plugin.

**Strengths:** free, full version history, works with any git host.
**Limitations:** changes take minutes rather than seconds, and editing the same note on two devices between syncs produces a merge conflict. Both versions are kept in the note with conflict markers (`<<<<<<<`), as obsidian-git does, so nothing is lost; the conflict can then be resolved in Obsidian.

## Setup

`obsidian-stack add` handles this, including generating an SSH deploy key. Each vault's sync is a service in the install's compose project, `<id>-sync` (written into `vaults.compose.yml` from `vault.yml` here), with its settings in `state/<id>/sync.env` (`GIT_REPO_URL`, `GIT_BRANCH`, `SYNC_INTERVAL`) and its deploy key in `state/<id>/ssh/`. From the install folder:

```bash
docker compose up -d --build <id>-sync
```

For SSH, the public key `state/<id>/ssh/id_ed25519.pub` must be added to the repository **with write access**. For HTTPS, include a token in the URL instead: `https://<token>@github.com/<user>/vault.git`. The folders `vaults/<id>/` and `state/<id>/ssh/` must be owned by uid 1000.

If the vault folder already contains notes and the repository does not exist locally yet, the notes are committed and merged with the remote's contents. Nothing is overwritten.
