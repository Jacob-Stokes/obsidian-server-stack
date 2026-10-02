import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mergeFrontmatter, sliceFrontmatter } from "./frontmatter.mjs";
import { availableVaults, registryFromEnv, vaultDir } from "./registry.mjs";

const API_KEY = process.env.API_KEY || "";
const PORT = parseInt(process.env.PORT || "3000", 10);
const MAX_BULK = parseInt(process.env.MAX_BULK || "500", 10);

function apiKey() {
  return API_KEY;
}

// Folders under .obsidian the API may read and write, from CONFIG_PATHS
// (comma-separated, e.g. ".obsidian/icons" for an icon plugin's custom
// icons). The rest of .obsidian (settings, plugins, workspace) stays out of
// reach. Returns each folder as path segments.
export function parseConfigPaths(spec) {
  return spec
    .split(",")
    .map((entry) => entry.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split("/");
      if (parts[0] !== ".obsidian" || parts.length < 2 || parts.some((p) => !p || p === "." || p === ".." || p.includes("\\"))) {
        throw new Error(`CONFIG_PATHS: "${entry}" must be a folder inside .obsidian, e.g. .obsidian/icons`);
      }
      return parts;
    });
}

// One vault's REST API, rooted at VAULT_PATH and (optionally) confined to the
// `scope` folder inside it. createApi() below routes each request to one of
// these by vault id.
export function createVaultApi(VAULT_PATH, expectedKey = apiKey, scope = "") {
  const scopedRoot = path.resolve(VAULT_PATH, scope);
  const configPaths = parseConfigPaths(process.env.CONFIG_PATHS || "");
  const app = new Hono();
  // ── Auth ──────────────────────────────────────────────────────────
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const expected = expectedKey();
    if (!expected) return c.json({ error: "API_KEY not configured" }, 500);
    const key = c.req.query("apiKey") || c.req.header("x-api-key") || "";
    if (key !== expected) return c.json({ error: "Invalid API key" }, 401);
    if (!resolvePath(scope)) return c.json({ error: "Vault scope needs recovery" }, 400);
    await next();
  });
  // ── Helpers ───────────────────────────────────────────────────────
  // allowTrash: only for a move's destination, which is how notes are
  // deleted (moved into .trash/). Everything else under .trash stays hidden.
  function resolvePath(p, { allowTrash = false } = {}) {
    const cleaned = p.replace(/^\/+/, "");
    const resolved = path.resolve(VAULT_PATH, cleaned);
    const root = path.resolve(VAULT_PATH);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    if (resolved !== scopedRoot && !resolved.startsWith(scopedRoot + path.sep)) return null;
    const segments = cleaned.split("/");
    const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
    const inConfigPath = configPaths.some((folder) => folder.every((part, i) => parts[i] === part));
    if (segments.some((part) => part === ".obsidian") && !inConfigPath) return null;
    if (segments.some((part, i) => part === ".trash" && !(allowTrash && i === 0))) return null;
    let current = root;
    for (const part of [null, ...parts]) {
      if (part !== null) current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) return null;
      } catch (error) {
        if (error.code !== "ENOENT") return null;
      }
    }
    return resolved;
  }
  function isHidden(name) {
    return name.startsWith(".");
  }
  function walk(dir, base, opts, results = [], currentDepth = 0) {
    if (!fs.existsSync(dir)) return results;
    if (opts.depth !== undefined && currentDepth > opts.depth) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (opts.includeDirs || opts.dirsOnly) results.push({ path: rel, type: "dir" });
        walk(full, rel, opts, results, currentDepth + 1);
      } else if (!opts.dirsOnly) {
        if (opts.ext && !entry.name.endsWith(`.${opts.ext}`)) continue;
        results.push({ path: rel, type: "file" });
      }
    }
    return results;
  }
  function buildTree(dir, base, depth, currentDepth = 0) {
    if (!fs.existsSync(dir)) return [];
    if (depth !== undefined && currentDepth >= depth) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push({
          name: entry.name,
          path: rel,
          type: "dir",
          children: buildTree(full, rel, depth, currentDepth + 1)
        });
      } else {
        const stat = fs.statSync(full);
        out.push({
          name: entry.name,
          path: rel,
          type: "file",
          size: stat.size,
          modified: stat.mtime.toISOString()
        });
      }
    }
    out.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }
  function decodeSplat(c, prefix) {
    return decodeURIComponent(c.req.path.replace(new RegExp(`^${prefix}/?`), ""));
  }
  // ── Health ────────────────────────────────────────────────────────
  app.get("/health", (c) => c.json({ status: "ok", vault: VAULT_PATH }));
  // ── Files ─────────────────────────────────────────────────────────
  app.get("/files", (c) => {
    const dirQ = c.req.query("dir") || scope;
    const ext = c.req.query("ext");
    const depth = c.req.query("depth") ? parseInt(c.req.query("depth"), 10) : undefined;
    const root = resolvePath(dirQ);
    if (!root) return c.json({ error: "Invalid dir" }, 400);
    const results = walk(root, dirQ.replace(/^\/+|\/+$/g, ""), { ext, depth });
    return c.json({ dir: dirQ, files: results.map((r) => r.path) });
  });
  app.get("/files/*", (c) => {
    const rel = decodeSplat(c, "/files");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    if (!fs.existsSync(resolved)) return c.json({ error: "File not found" }, 404);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return c.json({ error: "Path is a directory — use /folders/*" }, 400);
    const format = c.req.query("format");
    if (format === "base64") {
      const buf = fs.readFileSync(resolved);
      return c.json({
        path: rel,
        contentBase64: buf.toString("base64"),
        size: stat.size,
        modified: stat.mtime.toISOString()
      });
    }
    const content = fs.readFileSync(resolved, "utf-8");
    return c.json({
      path: rel,
      content,
      size: stat.size,
      modified: stat.mtime.toISOString()
    });
  });
  app.on("HEAD", "/files/*", (c) => {
    const rel = decodeSplat(c, "/files");
    const resolved = resolvePath(rel);
    if (!resolved || !fs.existsSync(resolved)) return c.body(null, 404);
    const stat = fs.statSync(resolved);
    c.header("X-Size", String(stat.size));
    c.header("X-Modified", stat.mtime.toISOString());
    c.header("X-Type", stat.isDirectory() ? "dir" : "file");
    return c.body(null, 200);
  });
  app.put("/files/*", async (c) => {
    const rel = decodeSplat(c, "/files");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    const body = await c.req.json();
    if (typeof body.content !== "string" && typeof body.contentBase64 !== "string") {
      return c.json({ error: "content or contentBase64 is required" }, 400);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (typeof body.contentBase64 === "string") {
      fs.writeFileSync(resolved, Buffer.from(body.contentBase64, "base64"));
    } else {
      fs.writeFileSync(resolved, body.content, "utf-8");
    }
    const stat = fs.statSync(resolved);
    return c.json({ path: rel, written: true, size: stat.size }, 201);
  });
  app.post("/files/*", async (c) => {
    const rel = decodeSplat(c, "/files");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    const body = await c.req.json();
    if (typeof body.content !== "string") return c.json({ error: "content is required" }, 400);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, body.content, "utf-8");
    return c.json({ path: rel, appended: true });
  });
  app.delete("/files/*", (c) => {
    const rel = decodeSplat(c, "/files");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    if (!fs.existsSync(resolved)) return c.json({ error: "File not found" }, 404);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return c.json({ error: "Path is a directory — use /folders/*" }, 400);
    fs.unlinkSync(resolved);
    return c.json({ path: rel, deleted: true });
  });
  /**
   * PATCH /frontmatter/* — merge the given fields into the file's YAML
   * frontmatter block, preserving everything else (unknown fields, the
   * note body, quoting style, field order).
   *
   * Body: { fields: { [key]: string | number | boolean | null } }
   *   - Scalar values only. null means "delete this field".
   *   - To set an array or nested object, use PUT /files/* instead.
   *
   * If the file has no frontmatter block yet, one is prepended.
   *
   * This is safer than fetching the whole file, modifying, and PUTting
   * back — it's a single atomic read-modify-write on the server.
   */
  app.patch("/frontmatter/*", async (c) => {
    const rel = decodeSplat(c, "/frontmatter");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    if (!fs.existsSync(resolved)) return c.json({ error: "File not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body.fields !== "object" || body.fields === null) {
      return c.json({ error: "fields object required" }, 400);
    }
    const patch = body.fields;
    for (const [k, v] of Object.entries(patch)) {
      if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        return c.json({ error: `field ${k} must be scalar or null` }, 400);
      }
    }
    const original = fs.readFileSync(resolved, "utf-8");
    const updated = mergeFrontmatter(original, patch);
    fs.writeFileSync(resolved, updated, "utf-8");
    const stat = fs.statSync(resolved);
    return c.json({ path: rel, written: true, size: stat.size });
  });
  /**
   * Same as PATCH /frontmatter/* but for N files in one request.
   *
   * Body: { patches: [{ path, fields }, ...] }
   */
  app.post("/bulk/frontmatter", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!Array.isArray(body.patches)) return c.json({ error: "patches array required" }, 400);
    if (body.patches.length > MAX_BULK) return c.json({ error: `max ${MAX_BULK} patches per request` }, 400);
    const results = await Promise.all(
      body.patches.map(async (p) => {
        if (!p || typeof p !== "object") return { path: String(p), error: "invalid patch" };
        const rec = p;
        const path_ = typeof rec.path === "string" ? rec.path : "";
        if (!path_) return { path: path_, error: "path required" };
        const fields = rec.fields;
        if (!fields || typeof fields !== "object") return { path: path_, error: "fields object required" };
        for (const [k, v] of Object.entries(fields)) {
          if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
            return { path: path_, error: `field ${k} must be scalar or null` };
          }
        }
        const abs = resolvePath(path_);
        if (!abs) return { path: path_, error: "invalid path" };
        if (!fs.existsSync(abs)) return { path: path_, error: "not found" };
        try {
          const original = fs.readFileSync(abs, "utf-8");
          const updated = mergeFrontmatter(original, fields);
          fs.writeFileSync(abs, updated, "utf-8");
          return { path: path_, written: true };
        } catch (e) {
          return { path: path_, error: e.message };
        }
      })
    );
    const ok = results.filter((r) => r.written).length;
    return c.json({ count: results.length, written: ok, results });
  });
  // ── Folders ───────────────────────────────────────────────────────
  app.get("/folders", (c) => {
    const dirQ = c.req.query("dir") || scope;
    const depth = c.req.query("depth") ? parseInt(c.req.query("depth"), 10) : undefined;
    const root = resolvePath(dirQ);
    if (!root) return c.json({ error: "Invalid dir" }, 400);
    const results = walk(root, dirQ.replace(/^\/+|\/+$/g, ""), { dirsOnly: true, depth });
    return c.json({ dir: dirQ, folders: results.map((r) => r.path) });
  });
  app.get("/folders/*", (c) => {
    const rel = decodeSplat(c, "/folders");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    if (!fs.existsSync(resolved)) return c.json({ error: "Folder not found" }, 404);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return c.json({ error: "Not a folder" }, 400);
    const children = [];
    for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
      if (isHidden(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(resolved, entry.name);
      const s = fs.statSync(full);
      const item = {
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file"
      };
      if (entry.isFile()) {
        item.size = s.size;
        item.modified = s.mtime.toISOString();
      }
      children.push(item);
    }
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return c.json({
      path: rel,
      children,
      counts: {
        files: children.filter((x) => x.type === "file").length,
        folders: children.filter((x) => x.type === "dir").length
      }
    });
  });
  app.put("/folders/*", (c) => {
    const rel = decodeSplat(c, "/folders");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    const existed = fs.existsSync(resolved);
    if (existed) {
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) return c.json({ error: "Path exists and is not a folder" }, 409);
    }
    fs.mkdirSync(resolved, { recursive: true });
    return c.json({ path: rel, created: !existed, existed }, existed ? 200 : 201);
  });
  app.on("HEAD", "/folders/*", (c) => {
    const rel = decodeSplat(c, "/folders");
    const resolved = resolvePath(rel);
    if (!resolved || !fs.existsSync(resolved)) return c.body(null, 404);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return c.body(null, 400);
    return c.body(null, 200);
  });
  app.delete("/folders/*", (c) => {
    const rel = decodeSplat(c, "/folders");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    if (resolved === path.resolve(VAULT_PATH)) return c.json({ error: "Refusing to delete vault root" }, 400);
    if (!fs.existsSync(resolved)) return c.json({ error: "Folder not found" }, 404);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return c.json({ error: "Not a folder" }, 400);
    const recursive = c.req.query("recursive") === "true";
    if (recursive) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      const entries = fs.readdirSync(resolved).filter((n) => !isHidden(n));
      if (entries.length > 0) return c.json({ error: "Folder not empty — pass ?recursive=true" }, 409);
      fs.rmdirSync(resolved);
    }
    return c.json({ path: rel, deleted: true, recursive });
  });
  // ── Move / Copy ──────────────────────────────────────────────────
  function moveOrCopy(mode) {
    return async (c) => {
      const body = await c.req.json();
      if (typeof body.from !== "string" || typeof body.to !== "string") {
        return c.json({ error: "from and to are required" }, 400);
      }
      const src = resolvePath(body.from);
      const dst = resolvePath(body.to, { allowTrash: mode === "move" });
      if (!src || !dst) return c.json({ error: "Invalid path" }, 400);
      if (!fs.existsSync(src)) return c.json({ error: "Source not found" }, 404);
      if (fs.existsSync(dst) && !body.overwrite) {
        return c.json({ error: "Destination exists — pass overwrite: true" }, 409);
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (mode === "move") {
        fs.renameSync(src, dst);
      } else {
        const srcStat = fs.statSync(src);
        if (srcStat.isDirectory()) {
          fs.cpSync(src, dst, { recursive: true, force: !!body.overwrite });
        } else {
          fs.copyFileSync(src, dst);
        }
      }
      const verb = mode === "move" ? "moved" : "copied";
      return c.json({ from: body.from, to: body.to, [verb]: true });
    };
  }
  app.post("/move", moveOrCopy("move"));
  app.post("/copy", moveOrCopy("copy"));
  // ── Tree ─────────────────────────────────────────────────────────
  app.get("/tree", (c) => {
    const depth = c.req.query("depth") ? parseInt(c.req.query("depth"), 10) : undefined;
    return c.json({ root: "", tree: buildTree(scopedRoot, scope, depth) });
  });
  app.get("/tree/*", (c) => {
    const rel = decodeSplat(c, "/tree");
    const resolved = resolvePath(rel);
    if (!resolved) return c.json({ error: "Invalid path" }, 400);
    if (!fs.existsSync(resolved)) return c.json({ error: "Not found" }, 404);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return c.json({ error: "Not a folder" }, 400);
    const depth = c.req.query("depth") ? parseInt(c.req.query("depth"), 10) : undefined;
    return c.json({ root: rel, tree: buildTree(resolved, rel, depth) });
  });
  // ── Stats ────────────────────────────────────────────────────────
  app.get("/stats", (c) => {
    let files = 0,
      folders = 0,
      notes = 0,
      totalSize = 0;
    const all = walk(scopedRoot, scope, { includeDirs: true });
    for (const entry of all) {
      if (entry.type === "dir") {
        folders++;
      } else {
        files++;
        if (entry.path.endsWith(".md")) notes++;
        const abs = resolvePath(entry.path);
        if (abs) totalSize += fs.statSync(abs).size;
      }
    }
    return c.json({ files, folders, notes, totalSize, vault: VAULT_PATH });
  });
  // ── Search ───────────────────────────────────────────────────────
  app.get("/search", (c) => {
    const query = c.req.query("q");
    if (!query) return c.json({ error: "q param required" }, 400);
    const dirQ = c.req.query("path") || "";
    const regex = c.req.query("regex") === "true";
    const caseSensitive = c.req.query("case") === "true";
    const ext = c.req.query("ext") || "md";
    const root = resolvePath(dirQ);
    if (!root) return c.json({ error: "Invalid path" }, 400);
    let matcher;
    if (regex) {
      try {
        const re = new RegExp(query, caseSensitive ? "" : "i");
        matcher = (l) => re.test(l);
      } catch (e) {
        return c.json({ error: `Invalid regex: ${e.message}` }, 400);
      }
    } else {
      const needle = caseSensitive ? query : query.toLowerCase();
      matcher = (l) => (caseSensitive ? l : l.toLowerCase()).includes(needle);
    }
    const files = walk(root, dirQ.replace(/^\/+|\/+$/g, ""), { ext }).map((r) => r.path);
    const results = [];
    for (const file of files) {
      const abs = resolvePath(file);
      if (!abs || !fs.existsSync(abs)) continue;
      const content = fs.readFileSync(abs, "utf-8");
      const lines = content.split("\n");
      const hit = lines.filter(matcher);
      if (hit.length > 0) results.push({ path: file, matches: hit.slice(0, 5) });
    }
    return c.json({ query, path: dirQ, regex, case: caseSensitive, count: results.length, results });
  });
  // ── Daily ────────────────────────────────────────────────────────
  function dailyFolder(override) {
    return override ?? "Daily";
  }
  app.get("/daily", (c) => {
    const today = new Date().toISOString().slice(0, 10);
    const folder = dailyFolder(c.req.query("folder") || undefined);
    const rel = `${folder}/${today}.md`;
    const abs = resolvePath(rel);
    if (!abs || !fs.existsSync(abs)) return c.json({ path: rel, exists: false }, 404);
    return c.json({ path: rel, exists: true, content: fs.readFileSync(abs, "utf-8") });
  });
  app.get("/daily/:date", (c) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    const folder = dailyFolder(c.req.query("folder") || undefined);
    const rel = `${folder}/${date}.md`;
    const abs = resolvePath(rel);
    if (!abs || !fs.existsSync(abs)) return c.json({ path: rel, exists: false }, 404);
    return c.json({ path: rel, exists: true, content: fs.readFileSync(abs, "utf-8") });
  });
  app.post("/daily/append", async (c) => {
    const body = await c.req.json();
    if (typeof body.content !== "string") return c.json({ error: "content is required" }, 400);
    const today = new Date().toISOString().slice(0, 10);
    const folder = dailyFolder(body.folder);
    const rel = `${folder}/${today}.md`;
    const abs = resolvePath(rel);
    if (!abs) return c.json({ error: "Invalid path" }, 400);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, `# ${today}\n\n${body.content}\n`, "utf-8");
    } else {
      fs.appendFileSync(abs, `\n${body.content}\n`, "utf-8");
    }
    return c.json({ path: rel, appended: true });
  });
  // ── Bulk ────────────────────────────────────────────────────────
  app.post("/bulk/write", async (c) => {
    const body = await c.req.json();
    if (!Array.isArray(body.files)) return c.json({ error: "files array required" }, 400);
    if (body.files.length > MAX_BULK) return c.json({ error: `max ${MAX_BULK} files per request` }, 400);
    const results = [];
    for (const f of body.files) {
      if (typeof f.path !== "string" || (typeof f.content !== "string" && typeof f.contentBase64 !== "string")) {
        results.push({ path: String(f.path), error: "path + content or contentBase64 required" });
        continue;
      }
      const abs = resolvePath(f.path);
      if (!abs) {
        results.push({ path: f.path, error: "invalid path" });
        continue;
      }
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (typeof f.contentBase64 === "string") {
          fs.writeFileSync(abs, Buffer.from(f.contentBase64, "base64"));
        } else {
          fs.writeFileSync(abs, f.content, "utf-8");
        }
        results.push({ path: f.path, written: true });
      } catch (e) {
        results.push({ path: f.path, error: e.message });
      }
    }
    const ok = results.filter((r) => r.written).length;
    return c.json({ count: results.length, written: ok, results });
  });
  app.post("/bulk/delete", async (c) => {
    const body = await c.req.json();
    if (!Array.isArray(body.paths)) return c.json({ error: "paths array required" }, 400);
    if (body.paths.length > MAX_BULK) return c.json({ error: `max ${MAX_BULK} paths per request` }, 400);
    const recursive = !!body.recursive;
    const results = [];
    for (const p of body.paths) {
      const abs = resolvePath(p);
      if (!abs) {
        results.push({ path: p, error: "invalid path" });
        continue;
      }
      if (abs === path.resolve(VAULT_PATH)) {
        results.push({ path: p, error: "refusing to delete vault root" });
        continue;
      }
      if (!fs.existsSync(abs)) {
        results.push({ path: p, error: "not found" });
        continue;
      }
      try {
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          if (recursive) {
            fs.rmSync(abs, { recursive: true, force: true });
          } else {
            fs.rmdirSync(abs);
          }
        } else {
          fs.unlinkSync(abs);
        }
        results.push({ path: p, deleted: true });
      } catch (e) {
        results.push({ path: p, error: e.message });
      }
    }
    const ok = results.filter((r) => r.deleted).length;
    return c.json({ count: results.length, deleted: ok, results });
  });
  /**
   * Bulk read many files in one request. Much cheaper than N HTTP
   * round-trips when callers need a lot of files' content (e.g. a
   * Thesys "list all unread articles" view building an index).
   *
   * Body:
   *   paths:            string[]   — required, up to MAX_BULK entries
   *   frontmatterOnly:  boolean    — if true, return only the YAML
   *                                  frontmatter block ("---\n...\n---"),
   *                                  not the full body. Large wins on
   *                                  long notes. Defaults to false.
   *   format:           "utf-8" | "base64" — mirrors GET /files/*
   *
   * Response:
   *   { count, results: [{ path, content?, contentBase64?, size, modified } | { path, error }] }
   */
  app.post("/bulk/read", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!Array.isArray(body.paths)) return c.json({ error: "paths array required" }, 400);
    if (body.paths.length > MAX_BULK) return c.json({ error: `max ${MAX_BULK} paths per request` }, 400);
    const frontmatterOnly = body.frontmatterOnly === true;
    const format = body.format === "base64" ? "base64" : "utf-8";
    const results = await Promise.all(
      body.paths.map(async (p) => {
        if (typeof p !== "string") return { path: String(p), error: "invalid path" };
        const abs = resolvePath(p);
        if (!abs) return { path: p, error: "invalid path" };
        if (!fs.existsSync(abs)) return { path: p, error: "not found" };
        try {
          const stat = fs.statSync(abs);
          if (stat.isDirectory()) return { path: p, error: "is a directory" };
          if (format === "base64") {
            // base64 + frontmatterOnly is a weird combo; we just read the
            // full bytes — frontmatterOnly only makes sense for utf-8.
            const buf = fs.readFileSync(abs);
            return {
              path: p,
              contentBase64: buf.toString("base64"),
              size: stat.size,
              modified: stat.mtime.toISOString()
            };
          }
          const full = fs.readFileSync(abs, "utf-8");
          const content = frontmatterOnly ? sliceFrontmatter(full) : full;
          return {
            path: p,
            content,
            size: stat.size,
            modified: stat.mtime.toISOString()
          };
        } catch (e) {
          return { path: p, error: e.message };
        }
      })
    );
    return c.json({ count: results.length, results });
  });
  return app;
}

function registryProblem(error) {
  return process.env.VAULTS ? error.message : "The vault registry needs attention; re-run install.sh";
}

export function createApi({ vaultsRoot = "/vaults", expectedKey = apiKey } = {}) {
  const app = new Hono();
  const routes = new Map();
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const expected = expectedKey();
    if (!expected) return c.json({ error: "API key is not available" }, 503);
    const key = c.req.header("x-api-key") || c.req.query("apiKey") || "";
    if (key !== expected) return c.json({ error: "Invalid API key" }, 401);
    return next();
  });
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/vaults", (c) => {
    try {
      return c.json({ vaults: availableVaults(vaultsRoot) });
    } catch (error) {
      return c.json({ error: registryProblem(error) }, 503);
    }
  });
  // Every other route needs an explicit vault, and the scope the caller last
  // saw: if the registry has since narrowed it, refuse rather than act on a
  // stale permission.
  app.all("*", async (c) => {
    const id = c.req.header("x-obsidian-vault-id");
    if (!id) return c.json({ error: "Choose vault_id from obsidian_list_vaults" }, 400);
    let permitted;
    try {
      permitted = availableVaults(vaultsRoot).find((vault) => vault.id === id);
    } catch (error) {
      return c.json({ error: registryProblem(error) }, 503);
    }
    if (!permitted) return c.json({ error: "Vault is unavailable or not permitted" }, 404);
    if (c.req.header("x-obsidian-scope") !== permitted.scopePath) {
      return c.json({ error: "Vault permissions changed. List vaults again before continuing." }, 409);
    }
    const root = vaultDir(vaultsRoot, id);
    const scope = permitted.scopePath.trim().replace(/^\/+|\/+$/g, "");
    const routeKey = JSON.stringify([root, scope]);
    let route = routes.get(routeKey);
    if (!route) {
      route = createVaultApi(root, expectedKey, scope);
      routes.set(routeKey, route);
    }
    return route.fetch(c.req.raw);
  });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // A mistake in VAULTS stops the container here rather than failing every request.
  if (process.env.VAULTS) registryFromEnv(process.env.VAULTS);
  parseConfigPaths(process.env.CONFIG_PATHS || "");
  const app = createApi({ vaultsRoot: process.env.VAULTS_ROOT || "/vaults" });
  console.log(`obsidian-api listening on :${PORT}`);
  serve({ fetch: app.fetch, port: PORT });
}
