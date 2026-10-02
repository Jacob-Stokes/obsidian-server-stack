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

const BasePath = z.string().min(1).max(500).describe("Vault-relative path of a .base file, from action=list.");

export const AppBasesInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({ action: z.literal("views"), path: BasePath }),
  z.object({
    action: z.literal("query"),
    path: BasePath,
    view: z.string().max(200).optional().describe("View name from action=views; the base's first view if omitted."),
    limit: z.number().int().min(1).max(1000).optional().describe("Most rows to return (default 100)."),
  }),
  z.object({
    action: z.literal("create_item"),
    path: BasePath,
    view: z.string().max(200).optional(),
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/).describe("Name of the new note."),
    content: z.string().max(100_000).optional().describe("Initial note body."),
  }),
]);
export const APP_BASES_TOOL = {
  name: "obsidian_app_bases",
  description:
    "Obsidian Bases (.base files: database views over notes), evaluated by the Obsidian app on the server exactly as Obsidian shows them. list: the vault's bases. views: a base's views. query: a view's rows as JSON, each with the note's path and the base's columns (properties and formulas). create_item: create a note in a base, so it gets the folder and properties the base's view expects.",
  inputSchema: AppBasesInput,
};

export const AppVaultHealthInput = z.object({
  check: z
    .enum(["orphans", "deadends", "unresolved"])
    .describe("orphans: notes no other note links to. deadends: notes that link to nothing. unresolved: links pointing at notes that don't exist, with where they come from."),
  limit: z.number().int().min(1).max(1000).optional().describe("Most items to return (default 100)."),
});
export const APP_VAULT_HEALTH_TOOL = {
  name: "obsidian_app_vault_health",
  description:
    "Link health for the vault, from the Obsidian app's own link index (which resolves aliases, partial paths and heading links the way Obsidian does). Useful for tidying a vault: finding orphaned notes, dead ends and broken links.",
  inputSchema: AppVaultHealthInput,
};

export const AppScreenshotInput = z.object({
  path: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("Vault-relative file to open first (a note, canvas, .base, Kanban board...). Omit to capture whatever is open."),
  wait_ms: z.number().int().min(0).max(10_000).optional().describe("How long to let it render before capturing (default 1500)."),
  width: z.number().int().min(320).max(3840).optional().describe("Layout width of the app window in CSS pixels (server default, normally 1600)."),
  height: z.number().int().min(240).max(2400).optional().describe("Layout height in CSS pixels (server default, normally 1000)."),
  scale: z
    .number()
    .min(1)
    .max(3)
    .optional()
    .describe("Pixel density: 1 = standard, 2 = Retina (same layout, twice the sharpness; server default, normally 2). The image is width x scale by height x scale pixels."),
});
export const APP_SCREENSHOT_TOOL = {
  name: "obsidian_app_screenshot",
  description:
    "A screenshot of the Obsidian app on the server, optionally after opening a file. Shows how Obsidian renders it: canvases, diagrams, Bases tables, plugin views such as Kanban, which can't be judged from the markdown alone. Returns a PNG image. Size is set per call (width, height, scale) or by the server's default, normally 1600x1000 at 2x; a wider layout fits more, a higher scale is sharper.",
  inputSchema: AppScreenshotInput,
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
export const handleAppBases = (t: AppTarget, i: z.infer<typeof AppBasesInput>) => call(t, "/bases", i);
export const handleAppVaultHealth = (t: AppTarget, i: z.infer<typeof AppVaultHealthInput>) =>
  call(t, "/vault_health", i);
export async function handleAppScreenshot(t: AppTarget, i: z.infer<typeof AppScreenshotInput>) {
  const shot = await call(t, "/screenshot", { ...i, ...(i.path ? { path: i.path.replace(/^\/+/, "") } : {}) });
  return {
    content: [
      { type: "image", data: shot.data, mimeType: shot.mimeType },
      {
        type: "text",
        text: `${i.path ? `Obsidian showing ${i.path}` : "Obsidian as it is now"}, ${shot.width}x${shot.height} at ${shot.scale}x (${shot.pixels} pixels)`,
      },
    ],
  };
}
