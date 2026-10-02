"""Small HTTP front for the official Obsidian CLI, for obsidian-mcp.

Runs as an s6 service inside the add-on's app container (obsidian-cli.service).
Each request runs one `obsidian <command>`; the CLI hands it to the running
app over the app's single-instance socket.

  server.py serve            HTTP on :7310 (Bearer APP_TOKEN), and keeps the
                             app running (see keep_alive)
  server.py health           exit 0 if the app is running
  server.py run <args...>    run one CLI command (used by obsidian-stack)

Only a fixed set of CLI commands is reachable over HTTP: listing and running
commands, and managing community plugins (with their settings), themes and CSS
snippets. `eval` and the rest are not. Commands can be narrowed further with
APP_COMMANDS, a comma-separated list of patterns such as
"obsidian-linter:*,templater-obsidian:*" (default *). APP_EXTENSIONS=read
leaves plugins, themes and snippets visible but unchangeable.
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
import urllib.request
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

# --- extensions: community plugins, themes, CSS snippets ----------------------

OBSIDIAN_DIR = "/vault/.obsidian"
DIRECTORY = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/"
THEME_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._'&()+-]{0,79}$")
SNIPPET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$")
_directory = {}


def directory(name, ttl=6 * 3600):
    """Obsidian's community directory (plugins, themes, download stats), cached."""
    hit = _directory.get(name)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    with urllib.request.urlopen(DIRECTORY + name, timeout=30) as r:
        data = json.load(r)
    _directory[name] = (time.time(), data)
    return data


def cli_json(*args, fields=("name", "version")):
    """A CLI listing as a list. Some commands (themes, snippets) ignore
    format=json and print tab-separated lines instead."""
    out = run(*args, "format=json").strip()
    if not out:
        return []
    try:
        return json.loads(out)
    except ValueError:
        return [dict(zip(fields, line.split("\t"))) for line in out.splitlines() if line.strip()]


def names(*args):
    return [item.get("name") if isinstance(item, dict) else item for item in cli_json(*args)]


def wait_for(check, seconds=60):
    for _ in range(seconds):
        if check():
            return True
        time.sleep(1)
    return False


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(value, f, indent=2)
    os.replace(tmp, path)


def merge(base, changes):
    """Deep merge, so {"ruleConfigs": {"x": {...}}} changes one rule, not all."""
    out = dict(base)
    for k, v in changes.items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def version_tuple(v):
    return tuple(int(x) if x.isdigit() else 0 for x in re.split(r"[.+-]", str(v or "0")))


def require_manage(action):
    if os.environ.get("APP_EXTENSIONS", "manage") != "manage":
        raise PermissionError(f"Changing extensions is turned off on this server (APP_EXTENSIONS); '{action}' isn't allowed.")


def installed_plugins():
    enabled = {p["id"] for p in cli_json("plugins:enabled", "filter=community")}
    out = []
    for p in cli_json("plugins", "filter=community", "versions"):
        manifest = read_json(os.path.join(OBSIDIAN_DIR, "plugins", p["id"], "manifest.json"), {})
        out.append({
            "id": p["id"], "name": manifest.get("name", p["id"]), "version": p.get("version"),
            "enabled": p["id"] in enabled, "description": manifest.get("description", ""),
        })
    return out


def latest_plugin_version(plugin_id):
    entry = next((p for p in directory("community-plugins.json") if p["id"] == plugin_id), None)
    if not entry:
        return None
    try:
        url = f"https://raw.githubusercontent.com/{entry['repo']}/HEAD/manifest.json"
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.load(r).get("version")
    except (OSError, ValueError):
        return None


def install_plugin(plugin_id, enable):
    if any(p["id"] == plugin_id for p in installed_plugins()):
        out = "already installed"
    else:
        out = run("plugin:install", f"id={plugin_id}", timeout=180)
        # The CLI returns before the download finishes.
        if not wait_for(lambda: any(p["id"] == plugin_id for p in installed_plugins())):
            raise RuntimeError(f"{plugin_id} didn't finish installing; check its id with action=search.")
    if enable:
        run("plugin:enable", f"id={plugin_id}", "filter=community")
    return out


def plugins(body):
    action = body.get("action", "list")
    if action == "list":
        return {"restrictedMode": run("plugins:restrict").strip() == "on", "plugins": installed_plugins()}

    if action == "search":
        query = str(body.get("query", "")).lower().strip()
        limit = max(1, min(int(body.get("limit", 10)), 50))
        stats = directory("community-plugin-stats.json")
        have = {p["id"] for p in installed_plugins()}
        hits = [
            p for p in directory("community-plugins.json")
            if not query or any(query in str(p.get(k, "")).lower() for k in ("id", "name", "description", "author"))
        ]
        hits.sort(key=lambda p: stats.get(p["id"], {}).get("downloads", 0), reverse=True)
        return {"plugins": [
            {**{k: p.get(k) for k in ("id", "name", "author", "description")},
             "downloads": stats.get(p["id"], {}).get("downloads", 0), "installed": p["id"] in have}
            for p in hits[:limit]
        ]}

    plugin_id = str(body.get("id", ""))
    if not PLUGIN_ID.match(plugin_id):
        raise ValueError("id must be a community plugin id, e.g. obsidian-linter (see action=search)")
    settings_path = os.path.join(OBSIDIAN_DIR, "plugins", plugin_id, "data.json")
    current = next((p for p in installed_plugins() if p["id"] == plugin_id), None)

    if action == "info":
        latest = latest_plugin_version(plugin_id)
        return {
            "installed": current, "latestVersion": latest,
            "updateAvailable": bool(current and latest and version_tuple(latest) > version_tuple(current["version"])),
        }
    if action == "get_settings":
        if not current:
            raise ValueError(f"{plugin_id} isn't installed.")
        return {"id": plugin_id, "settings": read_json(settings_path, {})}

    require_manage(action)
    if action == "install":
        return {"action": action, "id": plugin_id, "output": install_plugin(plugin_id, body.get("enable", True))}
    if not current:
        raise ValueError(f"{plugin_id} isn't installed (see action=list).")
    if action in ("enable", "disable"):
        return {"action": action, "id": plugin_id, "output": run(f"plugin:{action}", f"id={plugin_id}", "filter=community")}
    if action == "uninstall":
        out = run("plugin:uninstall", f"id={plugin_id}")
        wait_for(lambda: not any(p["id"] == plugin_id for p in installed_plugins()), 20)
        return {"action": action, "id": plugin_id, "output": out}
    if action == "set_settings":
        changes = body.get("settings")
        if not isinstance(changes, dict):
            raise ValueError("settings must be a JSON object")
        new = changes if body.get("mode") == "replace" else merge(read_json(settings_path, {}), changes)
        # Off while the file changes, so the plugin reads it fresh and can't
        # save its old copy over it.
        if current["enabled"]:
            run("plugin:disable", f"id={plugin_id}", "filter=community")
        write_json(settings_path, new)
        if current["enabled"]:
            run("plugin:enable", f"id={plugin_id}", "filter=community")
        return {"id": plugin_id, "settings": new}
    if action == "update":
        latest = latest_plugin_version(plugin_id)
        if not latest or version_tuple(latest) <= version_tuple(current["version"]):
            return {"id": plugin_id, "updated": False, "version": current["version"], "latestVersion": latest}
        # Obsidian's CLI has no update; reinstall, keeping the plugin's settings.
        saved = read_json(settings_path, None)
        run("plugin:uninstall", f"id={plugin_id}")
        wait_for(lambda: not any(p["id"] == plugin_id for p in installed_plugins()), 20)
        install_plugin(plugin_id, enable=False)
        if saved is not None:
            write_json(settings_path, saved)
        if current["enabled"]:
            run("plugin:enable", f"id={plugin_id}", "filter=community")
        now = next((p for p in installed_plugins() if p["id"] == plugin_id), {})
        return {"id": plugin_id, "updated": True, "from": current["version"], "to": now.get("version")}
    raise ValueError("action must be list, search, info, install, uninstall, enable, disable, update, get_settings or set_settings")


def appearance(body):
    action = body.get("action", "list")
    if action == "list":
        return {
            "activeTheme": run("theme").strip(),
            "themes": cli_json("themes", "versions"),
            "snippets": names("snippets"),
            "enabledSnippets": names("snippets:enabled"),
        }
    if action == "search_themes":
        query = str(body.get("query", "")).lower().strip()
        limit = max(1, min(int(body.get("limit", 10)), 50))
        hits = [t for t in directory("community-css-themes.json")
                if not query or query in t["name"].lower() or query in t.get("author", "").lower()]
        return {"themes": [{k: t.get(k) for k in ("name", "author", "modes")} for t in hits[:limit]]}

    require_manage(action)
    name = str(body.get("name", ""))
    if action in ("install_theme", "set_theme", "uninstall_theme"):
        if not (THEME_NAME.match(name) or (action == "set_theme" and name == "")):
            raise ValueError("name must be a theme name (see action=search_themes); for set_theme, empty means the default theme")
        if action == "install_theme":
            out = run("theme:install", f"name={name}", *(["enable"] if body.get("enable", True) else []), timeout=180)
            # Like plugins, the download finishes after the CLI returns.
            if not wait_for(lambda: name in names("themes")):
                raise RuntimeError(f"The theme {name} didn't finish installing; check its name with action=search_themes.")
            return {"action": action, "name": name, "output": out, "activeTheme": run("theme").strip()}
        if action == "set_theme":
            return {"action": action, "name": name or "(default)", "output": run("theme:set", f"name={name}")}
        return {"action": action, "name": name, "output": run("theme:uninstall", f"name={name}")}

    if not SNIPPET_NAME.match(name):
        raise ValueError("name must be a snippet name: letters, digits, spaces, _ . -")
    path = os.path.join(OBSIDIAN_DIR, "snippets", f"{name}.css")
    if action == "create_snippet":
        css = body.get("css")
        if not isinstance(css, str) or len(css) > 100_000:
            raise ValueError("css must be a string of CSS (up to 100 KB)")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(css)
        # Obsidian doesn't always notice a new file in .obsidian/snippets (not
        # if the folder is new), so ask it to rescan: fixed internal code, the
        # only eval this service runs.
        run("eval", "code=app.customCss.readSnippets(); 'ok'")
        if not wait_for(lambda: name in names("snippets"), 20):
            raise RuntimeError(f"Obsidian didn't pick up the snippet {name}.css.")
        if body.get("enable", True):
            run("snippet:enable", f"name={name}")
        return {"action": action, "name": name, "enabled": body.get("enable", True)}
    if action in ("enable_snippet", "disable_snippet"):
        verb = action.split("_")[0]
        return {"action": action, "name": name, "output": run(f"snippet:{verb}", f"name={name}")}
    if action == "delete_snippet":
        if not os.path.exists(path):
            raise ValueError(f"No snippet named {name}.")
        try:
            run("snippet:disable", f"name={name}")
        except ValueError:
            pass
        os.remove(path)
        return {"action": action, "name": name, "deleted": True}
    raise ValueError("action must be list, search_themes, install_theme, set_theme, uninstall_theme, create_snippet, enable_snippet, disable_snippet or delete_snippet")


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
        return plugins(body)
    if route == "/appearance":
        return appearance(body)

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
        except OSError as e:
            self.reply(502, {"error": f"Couldn't reach Obsidian's community directory or files: {e}"})
        except Exception as e:  # noqa: BLE001 — always answer, never drop the connection
            sys.stderr.write(f"unexpected error on {self.path}: {e!r}\n")
            self.reply(500, {"error": f"Unexpected error: {e}"})

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
