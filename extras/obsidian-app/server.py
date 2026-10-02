"""Small HTTP front for the official Obsidian CLI, for obsidian-mcp.

Runs as an s6 service inside the add-on's app container (obsidian-cli.service).
Each request runs one `obsidian <command>`; the CLI hands it to the running
app over the app's single-instance socket.

  server.py serve            HTTP on :7310 (Bearer APP_TOKEN), and keeps the
                             app running (see keep_alive)
  server.py health           exit 0 if the app is running
  server.py run <args...>    run one CLI command (used by obsidian-stack)

Only a fixed set of CLI commands is reachable over HTTP: listing and running
commands, and listing, installing and toggling plugins. `eval` and the rest
are not. Commands can be narrowed further with APP_COMMANDS, a comma-separated
list of patterns such as "obsidian-linter:*,templater-obsidian:*" (default *).
"""

import fnmatch
import hmac
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BIN = "/opt/obsidian/obsidian"
LOCK = "/config/.config/obsidian/SingletonLock"
PORT = 7310
ENV = {
    **os.environ,
    "HOME": "/config",
    "XDG_RUNTIME_DIR": "/config/.XDG",
    "WAYLAND_DISPLAY": "wayland-0",
}
# One CLI call at a time: "open this note, then run a command on it" must not
# interleave with another request.
SERIAL = threading.Lock()
# Commands that would take the app away from this vault or close it.
DENIED = {"app:open-another-vault", "app:open-sandbox-vault", "app:open-vault", "app:quit", "app:reload"}
COMMAND_ID = re.compile(r"^[A-Za-z0-9_.-]+:[A-Za-z0-9_.:-]+$")
PLUGIN_ID = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,99}$")
# Lines the CLI prints about itself (startup log, update check, Chromium noise).
NOISE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d |Ignored: |\[\d+:\d+/|.*ERROR:|.*dbus)")


def app_running():
    """True only if the app holding Obsidian's lock is alive in this pid namespace.

    Without this check, a CLI call made while the app is down (or starting)
    becomes a second app instance on the same settings.
    """
    try:
        host, pid = os.readlink(LOCK).rsplit("-", 1)
        if host != socket.gethostname():
            return False
        with open(f"/proc/{int(pid)}/cmdline", "rb") as f:
            return f.read().startswith(BIN.encode())
    except (OSError, ValueError):
        return False


def run(*args, timeout=90):
    if not app_running():
        raise RuntimeError("The Obsidian app isn't running (or is still starting); try again shortly.")
    proc = subprocess.run(
        [BIN, "--no-sandbox", "--ozone-platform=wayland", *args],
        env=ENV, capture_output=True, text=True, timeout=timeout,
    )
    lines = [l for l in (proc.stdout + proc.stderr).splitlines() if l.strip() and not NOISE.match(l)]
    out = "\n".join(lines)
    if out.startswith("Error:"):
        raise ValueError(out[len("Error:"):].strip())
    return out


def keep_alive():
    """Relaunch Obsidian if it goes away: a crash, or its window being closed
    in the browser. Nothing else in the image does, and the MCP's app tools
    need it running.

    Only after the app has been seen running once, so this never races the
    desktop's own launch at startup, and only after ~30s of absence.
    """
    seen, missing = False, 0
    while True:
        time.sleep(10)
        if app_running():
            seen, missing = True, 0
            continue
        missing += 1
        if seen and missing >= 3 and os.path.exists("/config/.XDG/wayland-0"):
            sys.stderr.write("obsidian isn't running; relaunching it\n")
            with SERIAL:
                subprocess.Popen(
                    ["/usr/bin/obsidian"], env={**ENV, "DISPLAY": ":0"}, start_new_session=True,
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            missing = -6  # give it a minute to start before trying again


def allowed(command_id):
    patterns = [p.strip() for p in os.environ.get("APP_COMMANDS", "*").split(",") if p.strip()]
    return command_id not in DENIED and any(fnmatch.fnmatchcase(command_id, p) for p in patterns)


def safe_path(path):
    parts = path.strip("/").split("/")
    return path and "\\" not in path and all(p and p not in (".", "..") and not p.startswith(".") for p in parts)


def handle(route, body):
    if route == "/commands":
        # Editor commands (most plugin commands) only exist while a note is open.
        path = body.get("path")
        if path is not None:
            if not isinstance(path, str) or not safe_path(path):
                raise ValueError("path must be a vault-relative file path")
            run("open", f"path={path}")
        ids = [l.strip() for l in run("commands").splitlines() if COMMAND_ID.match(l.strip())]
        query = str(body.get("query", "")).lower()
        return {"commands": [{"id": i, "allowed": allowed(i)} for i in ids if query in i.lower()]}

    if route == "/command":
        command_id = str(body.get("id", ""))
        if not COMMAND_ID.match(command_id):
            raise ValueError("id must be a command id such as obsidian-linter:lint-file")
        if not allowed(command_id):
            raise PermissionError(f"{command_id} is not allowed on this server (APP_COMMANDS).")
        path = body.get("path")
        if path is not None:
            if not isinstance(path, str) or not safe_path(path):
                raise ValueError("path must be a vault-relative file path")
            run("open", f"path={path}")
        return {"executed": command_id, "path": path, "output": run("command", f"id={command_id}")}

    if route == "/plugins":
        action = body.get("action", "list")
        if action == "list":
            installed = run("plugins", "filter=community").splitlines()
            enabled = set(run("plugins:enabled", "filter=community").splitlines())
            return {
                "restrictedMode": run("plugins:restrict").strip() == "on",
                "plugins": [{"id": p, "enabled": p in enabled} for p in installed if p],
            }
        plugin_id = str(body.get("id", ""))
        if action not in ("install", "enable", "disable") or not PLUGIN_ID.match(plugin_id):
            raise ValueError("action must be list, install, enable or disable, with a plugin id")
        if action == "install":
            # The CLI returns before the download finishes; wait until the
            # plugin is really there, so the next call (enable) finds it.
            try:
                out = run("plugin:install", f"id={plugin_id}", timeout=180)
            except ValueError as e:
                if "already installed" not in str(e):
                    raise
                return {"action": action, "id": plugin_id, "installed": True, "alreadyInstalled": True}
            for _ in range(60):
                if plugin_id in run("plugins", "filter=community").splitlines():
                    return {"action": action, "id": plugin_id, "installed": True, "output": out}
                time.sleep(1)
            raise RuntimeError(f"{plugin_id} didn't finish installing; check that it exists in the community directory.")
        else:
            out = run(f"plugin:{action}", f"id={plugin_id}", "filter=community")
        return {"action": action, "id": plugin_id, "output": out}

    raise LookupError(route)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True, "app": app_running()})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        token = os.environ.get("APP_TOKEN", "")
        given = self.headers.get("Authorization", "")
        if not token or not hmac.compare_digest(given.encode(), f"Bearer {token}".encode()):
            return self.reply(401, {"error": "unauthorized"})
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 65536)
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("body must be a JSON object")
            with SERIAL:
                result = handle(self.path, body)
            self.reply(200, result)
        except LookupError:
            self.reply(404, {"error": "not found"})
        except PermissionError as e:
            self.reply(403, {"error": str(e)})
        except (ValueError, json.JSONDecodeError) as e:
            self.reply(400, {"error": str(e)})
        except RuntimeError as e:
            self.reply(503, {"error": str(e)})
        except subprocess.TimeoutExpired:
            self.reply(504, {"error": "The Obsidian CLI timed out."})

    def log_message(self, fmt, *args):
        sys.stderr.write(fmt % args + "\n")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if mode == "health":
        sys.exit(0 if app_running() else 1)
    if mode == "run":
        try:
            print(run(*sys.argv[2:]))
        except (RuntimeError, ValueError) as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    threading.Thread(target=keep_alive, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
