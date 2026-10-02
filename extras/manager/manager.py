"""The manager add-on: a small HTTP service through which obsidian-mcp manages
this install, by running obsidian-stack with arguments checked here.

Listens on :7320, reachable only on the stack's internal network, with
Bearer MANAGER_TOKEN. Every request becomes one `obsidian-stack ... --yes`
run (one at a time); nothing else is reachable: no raw Docker, no shell, no
uninstall or update, no deleting notes.

  manager.py serve     (default)
  manager.py health    exit 0 if obsidian-stack answers
"""

import hmac
import json
import os
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STACK = os.environ["STACK_DIR"]
CLI = [os.path.join(STACK, "obsidian-stack"), "--dir", STACK]
PORT = 7320
SERIAL = threading.Lock()

VAULT_ID = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
URL = re.compile(r"^https?://[A-Za-z0-9.\-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/%\-]*)?$")
GIT_REPO = re.compile(r"^(?:[A-Za-z0-9._\-]+@[A-Za-z0-9.\-]+:|https://|ssh://)[A-Za-z0-9._~/%@:+\-]+$")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# Sources a vault can be added with from here. "existing-livesync" needs a
# Setup URI and passphrase from another setup, which belong at the
# terminal, not in a conversation; Official Sync only with an account
# already signed in on this server (no Obsidian password through here).
SOURCES = {"livesync", "official", "git", "none"}


class Refused(Exception):
    """A request that's understood but not allowed or not possible (400)."""


def text(value, field, limit=120):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or re.search(r"[\x00-\x1f\x7f]", value):
        raise Refused(f"{field} must be text, up to {limit} characters")
    return value.strip()


def vault_id(body, field="vault_id"):
    v = body.get(field)
    if not isinstance(v, str) or not VAULT_ID.match(v):
        raise Refused(f"{field} must be a vault id (see obsidian_stack_status)")
    return v


def flag(body, field):
    v = body.get(field, False)
    if not isinstance(v, bool):
        raise Refused(f"{field} must be true or false")
    return "yes" if v else "no"


def run(*args, timeout=1800, stdout_only=False):
    """obsidian-stack ARGS --yes; returns its output, or raises with the reason."""
    env = {**os.environ, "NO_COLOR": "1", "TERM": "dumb"}
    proc = subprocess.run([*CLI, *args, "--yes"], capture_output=True, text=True, timeout=timeout,
                          stdin=subprocess.DEVNULL, env=env)
    out = ANSI.sub("", proc.stdout + proc.stderr)
    if proc.returncode != 0:
        errors = [l.strip(" ✗") for l in out.splitlines() if "✗" in l]
        raise RuntimeError(errors[-1] if errors else "\n".join(out.strip().splitlines()[-8:]))
    return proc.stdout if stdout_only else out


def run_json(*args):
    # stdout is only the JSON; progress and prompts go to stderr
    return json.loads(run(*args, "--json", stdout_only=True))


def tail(out, lines=25):
    return "\n".join(l for l in out.strip().splitlines()[-lines:])


def device_url_saved():
    try:
        with open(os.path.join(STACK, "sync/couchdb/.env")) as f:
            return any(l.startswith("COUCHDB_DEVICE_URL=") and l.split("=", 1)[1].strip().strip('"') for l in f)
    except OSError:
        return False


def vault_entry(vid):
    return next((v for v in run_json("vaults") if v["id"] == vid), None)


def vaults(body):
    action = body.get("action")
    if action == "add":
        name = text(body.get("name"), "name")
        source = body.get("source")
        if source not in SOURCES:
            raise Refused("source must be livesync, official, git or none (an existing LiveSync server is added at the terminal)")
        args = ["add", "--name", name, "--source", source, "--app", flag(body, "app")]
        if source == "livesync":
            url = body.get("device_url")
            if url is not None:
                if not isinstance(url, str) or not URL.match(url):
                    raise Refused("device_url must be an http(s) address, e.g. https://couchdb.example.com")
                args += ["--device-url", url]
            elif not device_url_saved():
                raise Refused("device_url is needed for the first self-hosted LiveSync vault: the address devices use to reach CouchDB (https:// for phones)")
        if source == "git":
            repo = body.get("git_repo")
            if not isinstance(repo, str) or not GIT_REPO.match(repo) or len(repo) > 300:
                raise Refused("git_repo must be a repository URL, e.g. git@github.com:you/vault.git")
            args += ["--git-repo", repo]
        if source == "official":
            args += ["--reuse-login", "yes"]
            if body.get("official_vault") is not None:
                args += ["--official-vault", text(body.get("official_vault"), "official_vault")]
        before = {v["id"] for v in run_json("vaults")}
        out = run(*args)
        added = [v for v in run_json("vaults") if v["id"] not in before]
        if not added:
            raise RuntimeError("the vault wasn't added:\n" + tail(out, 8))
        vault, result = added[0], {"added": added[0]}
        if source == "livesync":
            result["setup_uri"] = run_json("setup-uri", vault["id"])
        if source == "git":
            key = os.path.join(STACK, "state", vault["id"], "ssh", "id_ed25519.pub")
            if os.path.exists(key):
                with open(key) as f:
                    result["deploy_key"] = f.read().strip()
                result["note"] = "Add deploy_key to the repository with write access; sync fails until then."
        return result
    vid = vault_id(body)
    if action == "remove":
        if not vault_entry(vid):
            raise Refused(f"no vault '{vid}'")
        run("remove", vid)
        return {"removed": vid, "note": f"Its notes stay in vaults/{vid}/ on the server; nothing was deleted."}
    if action == "rename":
        run("rename", vid, text(body.get("name"), "name"))
        return {"renamed": vault_entry(vid)}
    raise Refused("action must be add, remove or rename")


def sync(body):
    vid = vault_id(body)
    action = body.get("action")
    target = f"app:{vid}" if body.get("app") is True else vid
    if action == "restart":
        run("restart", target, timeout=300)
        return {"restarted": target}
    if action == "logs":
        lines = body.get("lines", 50)
        if not isinstance(lines, int) or not 1 <= lines <= 500:
            raise Refused("lines must be 1-500")
        return {"target": target, "logs": run("logs", target, "--tail", str(lines), timeout=60)}
    raise Refused("action must be restart or logs")


def app(body):
    vid = vault_id(body)
    action = body.get("action")
    if action == "enable":
        out = run("app", "enable", vid, "--plugins", flag(body, "plugins"))
        return {"enabled": vault_entry(vid), "output": tail(out, 6)}
    if action == "disable":
        run("app", "disable", vid, timeout=300)
        return {"disabled": vid}
    raise Refused("action must be enable or disable")


def setup_uri(body):
    vid = vault_id(body)
    args = ["setup-uri", vid]
    if body.get("device_url") is not None:
        url = body["device_url"]
        if not isinstance(url, str) or not URL.match(url):
            raise Refused("device_url must be an http(s) address")
        args += ["--url", url]
    return run_json(*args)


ROUTES = {
    "/status": lambda body: run_json("status"),
    "/vaults": vaults,
    "/sync": sync,
    "/app": app,
    "/setup_uri": setup_uri,
}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200, {"ok": True} if self.path == "/health" else {"error": "not found"})

    def do_POST(self):
        token = os.environ.get("MANAGER_TOKEN", "")
        given = self.headers.get("Authorization", "")
        if not token or not hmac.compare_digest(given.encode(), f"Bearer {token}".encode()):
            return self.reply(401, {"error": "unauthorized"})
        route = ROUTES.get(self.path)
        if not route:
            return self.reply(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 65536)
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise Refused("body must be a JSON object")
            with SERIAL:
                result = route(body)
            self.reply(200, result)
        except (Refused, json.JSONDecodeError) as e:
            self.reply(400, {"error": str(e)})
        except subprocess.TimeoutExpired:
            self.reply(504, {"error": "obsidian-stack took too long; check: obsidian-stack status"})
        except RuntimeError as e:
            self.reply(500, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 — always answer
            sys.stderr.write(f"unexpected error on {self.path}: {e!r}\n")
            self.reply(500, {"error": f"Unexpected error: {e}"})

    def log_message(self, fmt, *args):
        sys.stderr.write(fmt % args + "\n")


if __name__ == "__main__":
    if (sys.argv[1] if len(sys.argv) > 1 else "serve") == "health":
        sys.exit(subprocess.run([*CLI, "help"], capture_output=True).returncode)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
