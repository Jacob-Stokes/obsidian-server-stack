// The vault registry: which vaults this stack serves, and where they come from.
//
// Lives at <vaults>/.registry.json, next to the vault folders themselves
// (<vaults>/<id>/). Kept inside the mounted vaults directory rather than as a
// single bind-mounted file so that atomic rewrites (write temp + rename) are
// seen by the running API immediately. Ids can't start with a dot, so the
// registry can never be mistaken for a vault.
//
// Used two ways:
//   - imported by server.mjs, which re-reads it on each request, so adding a
//     vault needs no restart;
//   - run as a CLI by install.sh (inside the API image, so the host needs no
//     Node or jq) to list, add and remove vaults.
//
// Format matches ScholarServer's vault inventory where it overlaps, so the MCP
// contract (obsidian_list_vaults + vault_id) is the same in both.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
export const SOURCES = ["livesync", "livesync-existing", "official", "git", "none"];
const MAX_VAULTS = 32;
const REGISTRY_FILE = ".registry.json";

export function registryPath(vaultsRoot) {
  return path.join(vaultsRoot, REGISTRY_FILE);
}

export function emptyRegistry() {
  return { schemaVersion: 1, revision: 1, vaults: [] };
}

function validName(name) {
  return typeof name === "string" && name.trim() && name.trim().length <= 120 && !/[\x00-\x1f\x7f]/.test(name);
}

// "/" (or empty) means the whole vault; otherwise a relative folder AI tools
// are confined to. Same rules ScholarServer applies to its scopePath.
function validScope(scope) {
  if (typeof scope !== "string" || !scope.trim()) return false;
  const s = scope.trim().replace(/^\/+|\/+$/g, "");
  if (!s) return true;
  return !s.includes("\\") && !/[\x00-\x1f\x7f]/.test(s) && s.split("/").every((p) => p && p !== "." && p !== ".." && !p.startsWith("."));
}

export function validateRegistry(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Array.isArray(value.vaults) ||
    value.vaults.length > MAX_VAULTS ||
    Object.keys(value).some((k) => !["schemaVersion", "revision", "vaults"].includes(k))
  ) {
    throw new Error("The vault registry is invalid; it has not been changed.");
  }
  const ids = new Set();
  const names = new Set();
  for (const v of value.vaults) {
    if (
      !v ||
      !ID_PATTERN.test(v.id) ||
      ids.has(v.id) ||
      !validName(v.name) ||
      !SOURCES.includes(v.source) ||
      typeof v.aiEnabled !== "boolean" ||
      (v.scopePath !== undefined && !validScope(v.scopePath)) ||
      (v.app !== undefined && typeof v.app !== "boolean") ||
      Object.keys(v).some((k) => !["id", "name", "source", "aiEnabled", "scopePath", "app"].includes(k))
    ) {
      throw new Error(`The vault registry has an invalid entry${v?.id ? ` (${v.id})` : ""}.`);
    }
    const lower = v.name.trim().toLocaleLowerCase();
    if (names.has(lower)) throw new Error(`Two vaults are both named "${v.name}".`);
    names.add(lower);
    ids.add(v.id);
  }
  return value;
}

// VAULTS="id[:source[:name]],..." sets the vault list from the environment
// instead of the registry file, for a deployment run with plain docker compose
// rather than obsidian-stack (which manages the file). Each vault's folder is
// <vaults>/<id>; source defaults to "none", name to the id.
export function registryFromEnv(spec) {
  const vaults = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, source, ...name] = entry.split(":");
      return { id: id.trim(), name: name.join(":").trim() || id.trim(), source: source?.trim() || "none", aiEnabled: true };
    });
  try {
    return validateRegistry({ schemaVersion: 1, revision: 1, vaults });
  } catch (error) {
    throw new Error(`VAULTS: ${error.message.replace("The vault registry", "the vault list")}`);
  }
}

export function readRegistry(vaultsRoot, { optional = false } = {}) {
  if (process.env.VAULTS) return registryFromEnv(process.env.VAULTS);
  let raw;
  try {
    const fd = fs.openSync(registryPath(vaultsRoot), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > 128 * 1024) throw new Error("The vault registry is not a regular file.");
      raw = fs.readFileSync(fd, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (optional && error.code === "ENOENT") return emptyRegistry();
    throw error;
  }
  return validateRegistry(JSON.parse(raw));
}

function writeRegistry(vaultsRoot, registry) {
  if (process.env.VAULTS) throw new Error("The vaults are set by VAULTS in the environment; change them there.");
  validateRegistry(registry);
  fs.mkdirSync(vaultsRoot, { recursive: true });
  const tmp = path.join(vaultsRoot, `.registry-${randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, "wx", 0o644);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(registry, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, registryPath(vaultsRoot));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function vaultDir(vaultsRoot, id) {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid vault id.");
  return path.join(vaultsRoot, id);
}

// What the MCP may see: AI-enabled vaults whose folder exists. Re-read on
// every call, so one unreadable folder can't hide the others.
export function availableVaults(vaultsRoot) {
  const out = [];
  for (const v of readRegistry(vaultsRoot, { optional: true }).vaults) {
    if (!v.aiEnabled) continue;
    try {
      if (!fs.lstatSync(vaultDir(vaultsRoot, v.id)).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ id: v.id, name: v.name, source: v.source, scopePath: v.scopePath ?? "/", app: v.app === true });
  }
  return out;
}

// A readable, unique id from a vault name: "Work Notes" -> "work-notes".
export function suggestId(vaultsRoot, name) {
  const taken = new Set(readRegistry(vaultsRoot, { optional: true }).vaults.map((v) => v.id));
  let base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  if (!/^[a-z]/.test(base)) base = `vault${base ? `-${base}` : ""}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function addVault(vaultsRoot, { id, name, source, scopePath }) {
  const reg = readRegistry(vaultsRoot, { optional: true });
  if (reg.vaults.some((v) => v.id === id)) throw new Error(`A vault with id "${id}" already exists.`);
  const vault = { id, name: name.trim(), source, aiEnabled: true };
  if (scopePath && scopePath !== "/") vault.scopePath = scopePath;
  writeRegistry(vaultsRoot, { ...reg, revision: reg.revision + 1, vaults: [...reg.vaults, vault] });
  fs.mkdirSync(vaultDir(vaultsRoot, id), { recursive: true });
  return vault;
}

export function removeVault(vaultsRoot, id) {
  const reg = readRegistry(vaultsRoot);
  if (!reg.vaults.some((v) => v.id === id)) throw new Error(`No vault with id "${id}".`);
  writeRegistry(vaultsRoot, { ...reg, revision: reg.revision + 1, vaults: reg.vaults.filter((v) => v.id !== id) });
}

// Turns the optional Obsidian app add-on (extras/obsidian-app) on or off for a
// vault. Only a flag: obsidian-stack starts and stops the containers.
export function setApp(vaultsRoot, id, enabled) {
  const reg = readRegistry(vaultsRoot);
  if (!reg.vaults.some((v) => v.id === id)) throw new Error(`No vault with id "${id}".`);
  const vaults = reg.vaults.map((v) => {
    if (v.id !== id) return v;
    const { app, ...rest } = v;
    return enabled ? { ...rest, app: true } : rest;
  });
  writeRegistry(vaultsRoot, { ...reg, revision: reg.revision + 1, vaults });
}

// A vault's display name; its id (and folder) never change.
export function renameVault(vaultsRoot, id, name) {
  const reg = readRegistry(vaultsRoot);
  if (!reg.vaults.some((v) => v.id === id)) throw new Error(`No vault with id "${id}".`);
  const vaults = reg.vaults.map((v) => (v.id === id ? { ...v, name: name.trim() } : v));
  writeRegistry(vaultsRoot, { ...reg, revision: reg.revision + 1, vaults });
}

// --- CLI (used by install.sh) ------------------------------------------------
//   node registry.mjs <vaultsRoot> list               -> id<TAB>source<TAB>name per line
//   node registry.mjs <vaultsRoot> suggest-id <name>
//   node registry.mjs <vaultsRoot> add <id> <source> <name>
//   node registry.mjs <vaultsRoot> remove <id>
//   node registry.mjs <vaultsRoot> init                -> create an empty registry if missing
//   node registry.mjs <vaultsRoot> apps                -> ids of vaults with the app add-on on
//   node registry.mjs <vaultsRoot> set-app <id> on|off
//   node registry.mjs <vaultsRoot> rename <id> <name>

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [root, cmd, ...args] = process.argv.slice(2);
  try {
    if (!root || !cmd) throw new Error("usage: registry.mjs <vaultsRoot> <list|suggest-id|add|remove|init> ...");
    if (cmd === "list") {
      for (const v of readRegistry(root, { optional: true }).vaults) console.log(`${v.id}\t${v.source}\t${v.name}`);
    } else if (cmd === "suggest-id") {
      console.log(suggestId(root, args.join(" ")));
    } else if (cmd === "add") {
      const [id, source, ...name] = args;
      addVault(root, { id, source, name: name.join(" ") });
    } else if (cmd === "remove") {
      removeVault(root, args[0]);
    } else if (cmd === "rename") {
      const [id, ...name] = args;
      renameVault(root, id, name.join(" "));
    } else if (cmd === "apps") {
      for (const v of readRegistry(root, { optional: true }).vaults) if (v.app) console.log(v.id);
    } else if (cmd === "set-app") {
      if (!["on", "off"].includes(args[1])) throw new Error("usage: set-app <id> on|off");
      setApp(root, args[0], args[1] === "on");
    } else if (cmd === "init") {
      if (!fs.existsSync(registryPath(root))) writeRegistry(root, emptyRegistry());
    } else {
      throw new Error(`unknown command: ${cmd}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
