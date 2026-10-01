#!/usr/bin/env bash
# First-time setup. Everything lives in obsidian-stack; this is kept so the
# usual `./install.sh` works. Safe to re-run.
exec "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/obsidian-stack" install "$@"
