import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addVault, availableVaults, readRegistry, registryPath, removeVault, renameVault, setApp, suggestId } from "./registry.mjs";
import { createApi, parseConfigPaths } from "./server.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-vaults-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = createApi({ vaultsRoot: root, expectedKey: () => "test-key" });
  const headers = (id, scope = "/") => ({ "x-api-key": "test-key", "x-obsidian-vault-id": id, "x-obsidian-scope": scope });
  const write = (id, file, content, scope = "/") =>
    app.request(`/files/${file}`, {
      method: "PUT",
      headers: { ...headers(id, scope), "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  return { root, app, headers, write };
}

test("vaults from different sources keep the same note path separate, and every call names its vault", async (t) => {
  const { root, app, headers, write } = fixture(t);
  addVault(root, { id: "research", name: "Research", source: "official" });
  addVault(root, { id: "notes", name: "Notes", source: "livesync" });

  const inventory = await (await app.request("/vaults", { headers: { "x-api-key": "test-key" } })).json();
  assert.deepEqual(
    inventory.vaults.map((v) => [v.id, v.name, v.source, v.scopePath]),
    [
      ["research", "Research", "official", "/"],
      ["notes", "Notes", "livesync", "/"],
    ],
  );

  assert.equal((await app.request("/vaults")).status, 401);
  assert.equal((await app.request("/files/Proof.md", { headers: { "x-api-key": "test-key" } })).status, 400);
  assert.equal((await app.request("/files/Proof.md", { headers: headers("missing") })).status, 404);

  for (const [id, content] of [["research", "First vault"], ["notes", "Second vault"]]) {
    assert.equal((await write(id, "Proof.md", content)).status, 201);
    const read = await app.request("/files/Proof.md", { headers: headers(id) });
    assert.equal((await read.json()).content, content);
    assert.equal(fs.readFileSync(path.join(root, id, "Proof.md"), "utf8"), content);
  }
});

test("one vault can't reach another, or the registry, by path tricks or symlinks", async (t) => {
  const { root, app, headers, write } = fixture(t);
  addVault(root, { id: "a", name: "A", source: "none" });
  addVault(root, { id: "b", name: "B", source: "none" });
  await write("b", "Secret.md", "b only");

  assert.equal((await app.request("/files/%2e%2e%2fb%2fSecret.md", { headers: headers("a") })).status, 400);
  assert.equal((await app.request("/files/%2e%2e%2f.registry.json", { headers: headers("a") })).status, 400);
  fs.symlinkSync(path.join(root, "b"), path.join(root, "a", "Neighbour"));
  assert.equal((await app.request("/files/Neighbour/Secret.md", { headers: headers("a") })).status, 400);
});

test("a narrowed scope is enforced, and a stale scope is refused", async (t) => {
  const { root, app, headers, write } = fixture(t);
  addVault(root, { id: "research", name: "Research", source: "git" });
  const reg = readRegistry(root);
  reg.vaults[0].scopePath = "Papers";
  reg.revision += 1;
  fs.writeFileSync(registryPath(root), JSON.stringify(reg));

  // a caller still holding "/" from before the change is stopped
  assert.equal((await app.request("/files/Proof.md", { headers: headers("research", "/") })).status, 409);
  assert.equal((await write("research", "Papers/In.md", "inside", "Papers")).status, 201);
  assert.equal((await write("research", "Outside.md", "outside", "Papers")).status, 400);
});

test("disabled, missing and corrupt entries fail closed without hiding the others", async (t) => {
  const { root, app, headers } = fixture(t);
  addVault(root, { id: "keep", name: "Keep", source: "none" });
  addVault(root, { id: "off", name: "Off", source: "none" });
  addVault(root, { id: "gone", name: "Gone", source: "none" });
  fs.rmSync(path.join(root, "gone"), { recursive: true });
  const reg = readRegistry(root);
  reg.vaults.find((v) => v.id === "off").aiEnabled = false;
  fs.writeFileSync(registryPath(root), JSON.stringify(reg));

  assert.deepEqual(availableVaults(root).map((v) => v.id), ["keep"]);
  assert.equal((await app.request("/files", { headers: headers("off") })).status, 404);

  fs.writeFileSync(registryPath(root), "not json");
  assert.equal((await app.request("/vaults", { headers: { "x-api-key": "test-key" } })).status, 503);
});

test("the registry refuses duplicates and bad ids, and suggests readable unique ids", (t) => {
  const { root } = fixture(t);
  addVault(root, { id: "work", name: "Work", source: "git" });
  assert.throws(() => addVault(root, { id: "work", name: "Other", source: "git" }), /already exists/);
  assert.throws(() => addVault(root, { id: "work-2", name: "work", source: "git" }), /both named/);
  assert.throws(() => addVault(root, { id: "../escape", name: "Escape", source: "git" }), /invalid entry/);
  assert.throws(() => addVault(root, { id: "x", name: "X", source: "dropbox" }), /invalid entry/);
  assert.equal(suggestId(root, "Work"), "work-2");
  assert.equal(suggestId(root, "My Research Notes!"), "my-research-notes");
  assert.equal(suggestId(root, "2024 Journal"), "vault-2024-journal");
  removeVault(root, "work");
  assert.deepEqual(readRegistry(root).vaults, []);
});

test("notes can be moved into .trash (how deletes work), but .trash and .obsidian stay closed otherwise", async (t) => {
  const { root, app, headers, write } = fixture(t);
  addVault(root, { id: "notes", name: "Notes", source: "livesync" });
  assert.equal((await write("notes", "Gone.md", "bye")).status, 201);
  const post = (route, body) =>
    app.request(route, { method: "POST", headers: { ...headers("notes"), "content-type": "application/json" }, body: JSON.stringify(body) });

  assert.equal((await post("/move", { from: "Gone.md", to: ".trash/2026/Gone.md" })).status, 200);
  assert.ok(fs.existsSync(path.join(root, "notes", ".trash", "2026", "Gone.md")));

  assert.equal((await app.request("/files/.trash/2026/Gone.md", { headers: headers("notes") })).status, 400);
  assert.equal((await post("/move", { from: ".trash/2026/Gone.md", to: "Back.md" })).status, 400);
  assert.equal((await post("/copy", { from: "Missing.md", to: ".trash/x.md" })).status, 400);
  assert.equal((await post("/move", { from: "Missing.md", to: "Sub/.trash/x.md" })).status, 400);
  assert.equal((await post("/move", { from: "Missing.md", to: ".obsidian/x.md" })).status, 400);
});

test("the app add-on flag is reported per vault and can be turned off again", async (t) => {
  const { root } = fixture(t);
  addVault(root, { id: "notes", name: "Notes", source: "livesync" });
  addVault(root, { id: "work", name: "Work", source: "git" });
  setApp(root, "notes", true);
  assert.deepEqual(availableVaults(root).map((v) => [v.id, v.app]), [["notes", true], ["work", false]]);
  setApp(root, "notes", false);
  assert.equal("app" in readRegistry(root).vaults[0], false);
  assert.throws(() => setApp(root, "missing", true), /No vault/);
});

test("renaming keeps the id and refuses a name another vault has", async (t) => {
  const { root } = fixture(t);
  addVault(root, { id: "notes", name: "Notes", source: "livesync" });
  addVault(root, { id: "work", name: "Work", source: "git" });
  renameVault(root, "notes", "Personal notes");
  assert.deepEqual(readRegistry(root).vaults.map((v) => [v.id, v.name]), [["notes", "Personal notes"], ["work", "Work"]]);
  assert.throws(() => renameVault(root, "notes", "work"), /named/);
  assert.throws(() => renameVault(root, "missing", "X"), /No vault/);
});

test("VAULTS in the environment sets the vault list in place of the registry file", async (t) => {
  const { root, app, headers, write } = fixture(t);
  addVault(root, { id: "from-file", name: "From file", source: "git" });
  fs.mkdirSync(path.join(root, "main"));
  fs.mkdirSync(path.join(root, "work"));
  process.env.VAULTS = " main:official , work:livesync:Work: Notes, nofolder ";
  t.after(() => delete process.env.VAULTS);

  const inventory = await (await app.request("/vaults", { headers: { "x-api-key": "test-key" } })).json();
  assert.deepEqual(
    inventory.vaults.map((v) => [v.id, v.name, v.source]),
    [
      ["main", "main", "official"],
      ["work", "Work: Notes", "livesync"],
    ],
    "the file's vaults are not used, and a vault without a folder is left out",
  );
  assert.equal((await write("main", "Note.md", "hello")).status, 201);
  assert.equal(fs.readFileSync(path.join(root, "main", "Note.md"), "utf8"), "hello");
  assert.equal((await app.request("/files/x.md", { headers: headers("from-file") })).status, 404);

  assert.throws(() => addVault(root, { id: "other", name: "Other", source: "none" }), /set by VAULTS/);
  assert.equal(readRegistry(root).vaults.length, 3);

  process.env.VAULTS = "Bad Id";
  assert.throws(() => readRegistry(root), /^Error: VAULTS: the vault list has an invalid entry/);
  const broken = await app.request("/vaults", { headers: { "x-api-key": "test-key" } });
  assert.equal(broken.status, 503);
  assert.match((await broken.json()).error, /^VAULTS:/);
});

test("CONFIG_PATHS opens named folders under .obsidian, and only those", async (t) => {
  const { root, app, headers, write } = fixture(t);
  addVault(root, { id: "main", name: "Main", source: "official" });
  fs.mkdirSync(path.join(root, "main", ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(root, "main", ".obsidian", "app.json"), "{}");

  assert.equal((await write("main", ".obsidian/icons/self-host/A.svg", "<svg/>")).status, 400, "closed by default");

  process.env.CONFIG_PATHS = ".obsidian/icons";
  t.after(() => delete process.env.CONFIG_PATHS);
  const fresh = createApi({ vaultsRoot: root, expectedKey: () => "test-key" });
  const put = (file) =>
    fresh.request(`/files/${encodeURIComponent(file)}`, {
      method: "PUT",
      headers: { ...headers("main"), "content-type": "application/json" },
      body: JSON.stringify({ content: "<svg/>" }),
    });
  assert.equal((await put(".obsidian/icons/self-host/A.svg")).status, 201);
  assert.equal(fs.readFileSync(path.join(root, "main", ".obsidian/icons/self-host/A.svg"), "utf8"), "<svg/>");
  assert.equal((await fresh.request(`/files/${encodeURIComponent(".obsidian/icons/self-host/A.svg")}`, { headers: headers("main") })).status, 200);
  for (const blocked of [".obsidian/app.json", ".obsidian/plugins/x/main.js", ".obsidian/icons-evil/x.svg", ".obsidian/icons/../app.json", "x/../.obsidian/app.json"]) {
    assert.equal((await fresh.request(`/files/${encodeURIComponent(blocked)}`, { headers: headers("main") })).status, 400, blocked);
  }

  for (const bad of [".obsidian", "notes", ".obsidian/../x", ".trash/x"]) {
    process.env.CONFIG_PATHS = bad;
    assert.throws(() => parseConfigPaths(process.env.CONFIG_PATHS), /CONFIG_PATHS/, bad);
  }
});
