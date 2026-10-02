import assert from "node:assert/strict";
import test from "node:test";
import { zodToJsonSchema } from "./schema.js";
import { obsidianTools } from "../vault-tools.js";
import { VaultConnections } from "./connections.js";

function backend(t: test.TestContext) {
  const notes = new Map([
    ["one", new Map<string, string>()],
    ["two", new Map<string, string>()]
  ]);
  let permitted = [
    { id: "one", name: "Research", source: "official", scopePath: "Research" },
    { id: "two", name: "Notes", source: "livesync", scopePath: "/" }
  ];
  t.mock.method(globalThis, "fetch", async (rawUrl: string, options: RequestInit) => {
    const url = new URL(rawUrl);
    const headers = new Headers(options.headers);
    if (headers.get("x-api-key") !== "synthetic") return Response.json({}, { status: 401 });
    if (url.pathname === "/vaults") return Response.json({ vaults: permitted });
    const vault = permitted.find((candidate) => candidate.id === headers.get("x-obsidian-vault-id"));
    if (!vault) return Response.json({}, { status: 404 });
    if (vault.scopePath !== headers.get("x-obsidian-scope")) return Response.json({}, { status: 409 });
    const path = decodeURIComponent(url.pathname.slice("/files/".length));
    const files = notes.get(vault.id)!;
    if (options.method === "PUT") {
      files.set(path, JSON.parse(String(options.body)).content);
      return Response.json({ written: true }, { status: 201 });
    }
    if (!files.has(path)) return Response.json({}, { status: 404 });
    return Response.json({ path, content: files.get(path), size: files.get(path)!.length });
  });
  return {
    connections: new VaultConnections("http://synthetic.invalid", "synthetic"),
    notes,
    revoke: () => {
      permitted = permitted.filter((vault) => vault.id !== "one");
    }
  };
}

test("one MCP inventory offers vault selection on every content tool", async (t) => {
  const { connections } = backend(t);
  const tools = obsidianTools(connections);
  assert.equal(new Set(tools.map((tool) => tool.def.name)).size, 24);
  assert.equal(tools.filter((tool) => tool.def.name === "obsidian_list_vaults").length, 1);
  for (const tool of tools) {
    if (tool.def.name === "obsidian_list_vaults") continue;
    const schema = zodToJsonSchema(tool.def.inputSchema);
    assert.ok(schema.properties.vault_id, tool.def.name);
    // optional, so a single-vault server needs no lookup first
    assert.ok(!schema.required.includes("vault_id"), tool.def.name);
    assert.equal(tool.def.inputSchema.safeParse({ vault_id: "../escape", path: "Research/Test.md" }).success, false);
  }
  assert.deepEqual(
    (await connections.list("research")).map((vault) => vault.id),
    ["one"]
  );
});

test("same-path writes choose explicit contexts; scope and revocation prevent later access", async (t) => {
  const { connections, notes, revoke } = backend(t);
  const tools = obsidianTools(connections);
  const write = tools.find((tool) => tool.def.name === "obsidian_write_note")!;
  const read = tools.find((tool) => tool.def.name === "obsidian_get_note")!;
  for (const id of ["one", "two"]) {
    const input = write.def.inputSchema.parse({ vault_id: id, path: "Research/Test.md", content: `Synthetic ${id}` });
    await write.handler(input);
    const result = (await read.handler(read.def.inputSchema.parse({ vault_id: id, path: "Research/Test.md" }))) as {
      content: string;
    };
    assert.equal(result.content, `Synthetic ${id}`);
  }
  assert.equal(notes.get("one")!.get("Research/Test.md"), "Synthetic one");
  assert.equal(notes.get("two")!.get("Research/Test.md"), "Synthetic two");
  await assert.rejects(connections.context("../two"), /Choose vault_id/);
  const first = await connections.context("one");
  assert.throws(() => first.policy.assertRead("Private.md"), /denied/);
  revoke();
  await assert.rejects(connections.context("one"), /unavailable or not permitted/);
  await assert.rejects(first.client.get("/api/files/Research/Test.md"), /404/);
  assert.deepEqual(
    (await connections.list()).map((vault) => vault.id),
    ["two"]
  );
});

test("an omitted vault_id uses the only vault, and is refused with the choices when there are several", async (t) => {
  const { connections, notes, revoke } = backend(t);
  const tools = obsidianTools(connections);
  const write = tools.find((tool) => tool.def.name === "obsidian_write_note")!;

  // two vaults: refuse, naming both so the caller can retry directly
  await assert.rejects(connections.context(), /2 vaults, so vault_id is required: one \(Research\), two \(Notes\)/);
  await assert.rejects(write.handler(write.def.inputSchema.parse({ path: "Inbox.md", content: "x" })), /vault_id is required/);
  assert.equal(notes.get("one")!.size + notes.get("two")!.size, 0);

  // down to one vault: id-less calls go to it
  revoke();
  assert.equal((await connections.context()).client !== undefined, true);
  await write.handler(write.def.inputSchema.parse({ path: "Inbox.md", content: "only vault" }));
  assert.equal(notes.get("two")!.get("Inbox.md"), "only vault");
});

test("app tools reach only vaults with the Obsidian app add-on, at their own container", async (t) => {
  const calls: { url: string; auth: string | null; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (rawUrl: string, options: RequestInit) => {
    const url = new URL(rawUrl);
    if (url.pathname === "/vaults") {
      return Response.json({
        vaults: [
          { id: "one", name: "Research", source: "official", scopePath: "/" },
          { id: "two", name: "Notes", source: "livesync", scopePath: "/", app: true }
        ]
      });
    }
    calls.push({ url: rawUrl, auth: new Headers(options.headers).get("authorization"), body: JSON.parse(String(options.body)) });
    return Response.json({ executed: "obsidian-linter:lint-file" });
  });
  const tools = obsidianTools(new VaultConnections("http://synthetic.invalid", "synthetic"));
  const run = tools.find((tool) => tool.def.name === "obsidian_app_run_command")!;

  process.env.OBSIDIAN_APP_TOKEN = "app-secret";
  process.env.OBSIDIAN_APP_HOST_PREFIX = "test-";
  t.after(() => {
    delete process.env.OBSIDIAN_APP_TOKEN;
    delete process.env.OBSIDIAN_APP_HOST_PREFIX;
  });

  // two vaults, but only one has the app, so the id can be left out
  await run.handler(run.def.inputSchema.parse({ id: "obsidian-linter:lint-file", path: "/Notes/a.md" }));
  assert.deepEqual(calls, [
    {
      url: "http://test-obsidian-two-app:7310/command",
      auth: "Bearer app-secret",
      body: { id: "obsidian-linter:lint-file", path: "Notes/a.md" }
    }
  ]);

  await assert.rejects(
    run.handler(run.def.inputSchema.parse({ vault_id: "one", id: "obsidian-linter:lint-file" })),
    /isn't enabled for 'one'\. Vaults with it: two/
  );

  delete process.env.OBSIDIAN_APP_TOKEN;
  await assert.rejects(
    run.handler(run.def.inputSchema.parse({ id: "obsidian-linter:lint-file" })),
    /OBSIDIAN_APP_TOKEN/
  );
  assert.equal(calls.length, 1);
});
