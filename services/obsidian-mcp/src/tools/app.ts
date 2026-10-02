import { z } from "zod";
import type { AppTarget } from "../lib/connections.js";

// Tools for the optional Obsidian app add-on (extras/obsidian-app): the full
// desktop app running on the server, driven through the official Obsidian
// CLI. Only listed to clients when at least one vault has the add-on on.

export const AppCommandsInput = z.object({
  query: z.string().max(120).optional().describe("Only return command ids containing this text, e.g. a plugin id."),
  path: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Vault-relative note to open first. Editor commands, which includes most plugin commands, are only listed while a note is open."),
});
export const APP_COMMANDS_TOOL = {
  name: "obsidian_app_commands",
  description:
    "List the commands available in the Obsidian app running on the server for this vault, including commands added by community plugins (ids look like plugin-id:command). Commands that act on a note only appear while one is open, so pass path to see those. 'allowed' says whether obsidian_app_run_command may run it here. Only vaults with the Obsidian app add-on support this.",
  inputSchema: AppCommandsInput,
};

export const AppRunCommandInput = z.object({
  id: z.string().min(3).max(200).describe("Command id from obsidian_app_commands, e.g. obsidian-linter:lint-file."),
  path: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Vault-relative file to open first, for commands that act on the current note."),
});
export const APP_RUN_COMMAND_TOOL = {
  name: "obsidian_app_run_command",
  description:
    "Run an Obsidian command in the app on the server, as if picked from the command palette. Use this for what only Obsidian or its plugins can do (e.g. Linter, Templater). Pass path to open a note first for commands that act on the current note. Changes are written to the vault and synced like any other edit.",
  inputSchema: AppRunCommandInput,
};

export const AppPluginsInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.enum(["install", "enable", "disable"]),
    id: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,99}$/).describe("Community plugin id, e.g. obsidian-linter."),
  }),
]);
export const APP_PLUGINS_TOOL = {
  name: "obsidian_app_plugins",
  description:
    "Community plugins in the Obsidian app on the server. list: installed plugins, whether each is enabled, and whether restricted mode is on (if it is, plugins can't run until the server's owner turns it off). install: download a plugin from the community directory. enable / disable: turn an installed plugin on or off.",
  inputSchema: AppPluginsInput,
};

async function call(target: AppTarget, route: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(`${target.url}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(200_000),
    });
  } catch {
    throw new Error(`Can't reach the Obsidian app for '${target.vault.id}'. Is it running? (obsidian-stack app status)`);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `The Obsidian app returned HTTP ${res.status}.`);
  return data;
}

export const handleAppCommands = (t: AppTarget, i: z.infer<typeof AppCommandsInput>) =>
  call(t, "/commands", { query: i.query ?? "", ...(i.path ? { path: i.path.replace(/^\/+/, "") } : {}) });
export const handleAppRunCommand = (t: AppTarget, i: z.infer<typeof AppRunCommandInput>) =>
  call(t, "/command", { id: i.id, ...(i.path ? { path: i.path.replace(/^\/+/, "") } : {}) });
export const handleAppPlugins = (t: AppTarget, i: z.infer<typeof AppPluginsInput>) =>
  call(t, "/plugins", i);
