import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addVault, availableVaults, readRegistry, registryPath, removeVault, suggestId } from "./registry.mjs";
import { createApi } from "./server.mjs";

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
