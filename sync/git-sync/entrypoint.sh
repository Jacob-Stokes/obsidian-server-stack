#!/bin/sh
# Keeps /vault in sync with a git remote: commit local changes, merge remote
# changes, push — on a timer. Devices sync against the same repo with the
# obsidian-git plugin.
set -eu

: "${GIT_REPO_URL:?GIT_REPO_URL is not set — see .env.example}"
BRANCH="${GIT_BRANCH:-main}"
INTERVAL="${SYNC_INTERVAL:-60}"
VAULT=/vault

log() { echo "[git-sync] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# SSH: use the mounted deploy key, and trust the host on first connect.
if [ -f /ssh/id_ed25519 ]; then
  export GIT_SSH_COMMAND="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/ssh/known_hosts -o StrictHostKeyChecking=accept-new"
fi

git config --global user.name "${GIT_AUTHOR_NAME:-obsidian-server-stack}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-obsidian-server-stack@localhost}"
git config --global init.defaultBranch "$BRANCH"

if [ ! -d "$VAULT/.git" ]; then
  if [ -n "$(ls -A "$VAULT" 2>/dev/null)" ]; then
    # Existing notes, no repo yet: adopt them, then merge in whatever the
    # remote already has rather than overwriting either side.
    log "vault has files but no git repo — initialising and linking to remote"
    git -C "$VAULT" init -q
    git -C "$VAULT" remote add origin "$GIT_REPO_URL"
    git -C "$VAULT" add -A
    git -C "$VAULT" commit -q -m "Initial commit from obsidian-server-stack"
    if git -C "$VAULT" fetch -q origin "$BRANCH" 2>/dev/null; then
      git -C "$VAULT" merge -q --no-edit --allow-unrelated-histories "origin/$BRANCH" \
        || { git -C "$VAULT" add -A; git -C "$VAULT" commit -q -m "Merge remote into existing vault (resolve conflict markers)"; }
    fi
    git -C "$VAULT" push -q -u origin "$BRANCH"
  else
    log "cloning $GIT_REPO_URL"
    if ! git clone -q --branch "$BRANCH" "$GIT_REPO_URL" "$VAULT" 2>/dev/null; then
      # Either the remote is empty (no branch yet) or we can't reach it yet
      # (e.g. deploy key not added). Start a fresh repo pointing at it — once
      # access works, the loop merges whatever the remote has, nothing lost.
      log "couldn't clone (empty repo, or no access yet — check the deploy key) — starting fresh and retrying"
      git -C "$VAULT" init -q
      git -C "$VAULT" remote add origin "$GIT_REPO_URL"
    fi
  fi
fi

cd "$VAULT"
log "syncing every ${INTERVAL}s on branch $BRANCH"

while true; do
  git add -A
  if ! git diff --cached --quiet; then
    git commit -q -m "vault: sync from server $(date '+%Y-%m-%d %H:%M:%S')"
    log "committed local changes"
  fi

  if git fetch -q origin "$BRANCH" 2>/dev/null; then
    if ! git merge -q --no-edit --allow-unrelated-histories "origin/$BRANCH" >/dev/null 2>&1; then
      if [ -f .git/MERGE_HEAD ]; then
        # Same note changed on both sides. Keep both versions in the file as
        # conflict markers (what obsidian-git does) so nothing is lost, and
        # carry on syncing — fix the markers in Obsidian when you see them.
        CONFLICTED="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
        git add -A
        git commit -q -m "vault: merge conflict — both versions kept, resolve markers"
        log "CONFLICT in: $CONFLICTED— both versions kept with markers"
      else
        log "merge failed (not a conflict) — will retry"
      fi
    fi
  fi

  # Push if we have commits the remote doesn't (or the remote branch doesn't exist yet).
  if [ -n "$(git rev-list "origin/$BRANCH..HEAD" 2>/dev/null || git rev-list HEAD 2>/dev/null || true)" ]; then
    if git push -q origin "HEAD:$BRANCH" 2>/dev/null; then
      log "pushed"
    else
      log "push failed — will retry (check the deploy key has write access)"
    fi
  fi

  sleep "$INTERVAL"
done
