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

const PluginId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]{0,99}$/)
  .describe("Community plugin id, e.g. obsidian-linter (from action=search or list).");

export const AppPluginsInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("search"),
    query: z.string().max(120).optional().describe("Words to match in the plugin's id, name, description or author."),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({ action: z.literal("info"), id: PluginId }),
  z.object({
    action: z.literal("install"),
    id: PluginId,
    enable: z.boolean().optional().describe("Enable it after installing (default true)."),
  }),
  z.object({ action: z.enum(["uninstall", "enable", "disable", "update", "get_settings"]), id: PluginId }),
  z.object({
    action: z.literal("set_settings"),
    id: PluginId,
    settings: z.record(z.any()).describe("Settings to change. Merged into the current ones (nested objects too) unless mode is replace."),
    mode: z.enum(["merge", "replace"]).optional(),
  }),
]);
export const APP_PLUGINS_TOOL = {
  name: "obsidian_app_plugins",
  description:
    "Community plugins in the Obsidian app on the server. list: installed plugins (name, version, enabled) and whether restricted mode is on (if it is, plugins can't run until the server's owner turns it off). search: Obsidian's community directory, most downloaded first. info: details, and whether an update is available. install (enables it by default), uninstall, enable, disable. update: install the latest version, keeping its settings. get_settings / set_settings: the plugin's own settings (its data.json); read them before changing, as each plugin has its own format. Plugins are third-party code that runs on the server.",
  inputSchema: AppPluginsInput,
};

const ThemeName = z.string().max(80).describe("Theme name as listed by search_themes, e.g. Minimal.");
const SnippetName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/)
  .describe("Snippet name, without .css.");

export const AppAppearanceInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("search_themes"),
    query: z.string().max(120).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({
    action: z.literal("install_theme"),
    name: ThemeName,
    enable: z.boolean().optional().describe("Make it the active theme (default true)."),
  }),
  z.object({ action: z.literal("set_theme"), name: ThemeName.describe("Installed theme name; empty string for Obsidian's default theme.") }),
  z.object({ action: z.literal("uninstall_theme"), name: ThemeName }),
  z.object({
    action: z.literal("create_snippet"),
    name: SnippetName,
    css: z.string().max(100_000).describe("The CSS. Replaces the snippet if one with this name exists."),
    enable: z.boolean().optional().describe("Enable it straight away (default true)."),
  }),
  z.object({ action: z.enum(["enable_snippet", "disable_snippet", "delete_snippet"]), name: SnippetName }),
]);
export const APP_APPEARANCE_TOOL = {
  name: "obsidian_app_appearance",
  description:
    "Themes and CSS snippets in the Obsidian app on the server. list: installed themes, the active one, and snippets. search_themes: Obsidian's community theme directory. install_theme, set_theme, uninstall_theme. create_snippet writes a CSS snippet into the vault's .obsidian/snippets and enables it; enable_snippet, disable_snippet, delete_snippet. Note that the server's app is mostly used by tools, so appearance changes matter mainly to whoever opens it in a browser, or to devices if the vault's sync carries .obsidian settings.",
  inputSchema: AppAppearanceInput,
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
export const handleAppAppearance = (t: AppTarget, i: z.infer<typeof AppAppearanceInput>) =>
  call(t, "/appearance", i);
