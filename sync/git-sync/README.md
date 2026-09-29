# Git sync

Keeps the vault in sync with a git repository. The server commits local changes, merges remote ones and pushes on a timer (every 60 seconds by default). Other devices sync against the same repository with the [obsidian-git](https://github.com/Vinzent03/obsidian-git) plugin.

**Strengths:** free, full version history, works with any git host.
**Limitations:** changes take minutes rather than seconds, and editing the same note on two devices between syncs produces a merge conflict. Both versions are kept in the note with conflict markers (`<<<<<<<`), as obsidian-git does, so nothing is lost; the conflict can then be resolved in Obsidian.

## Setup

The root `install.sh` handles this (the git option). To set it up manually:

1. `cp .env.example .env` and set `GIT_REPO_URL`.
2. For SSH, create a deploy key and add its public half to the repository **with write access**:
   ```bash
   mkdir -p ssh && ssh-keygen -t ed25519 -N "" -f ssh/id_ed25519 -C obsidian-server-stack
   chown -R 1000:1000 ssh ../../vault
   cat ssh/id_ed25519.pub
   ```
   For HTTPS, include a token in the URL instead: `https://<token>@github.com/<user>/vault.git`.
3. `docker compose up -d --build`, then check `docker compose logs -f`.

If the vault folder already contains notes and the repository does not exist locally yet, the notes are committed and merged with the remote's contents. Nothing is overwritten.
