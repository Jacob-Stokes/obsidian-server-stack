import { z } from "zod";

// Tools for the optional manager add-on (extras/manager): managing this
// install itself, through a fixed list of operations. Only listed to
// clients when OBSIDIAN_MANAGER_TOKEN is set (`obsidian-stack manager enable`).

const VaultId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/)
  .describe("Vault id, from obsidian_stack_status or obsidian_list_vaults.");

export const StackStatusInput = z.object({});
export const STACK_STATUS_TOOL = {
  name: "obsidian_stack_status",
  description:
    "Overview of this Obsidian server stack: the MCP and core containers, and every vault with its sync source, sync container state, note count and whether the Obsidian app runs for it.",
  inputSchema: StackStatusInput,
};

export const StackVaultsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    name: z.string().min(1).max(120).describe("Display name; the vault id is made from it (Work Notes → work-notes)."),
    source: z
      .enum(["livesync", "official", "git", "none"])
      .describe(
        "How the vault syncs with devices. livesync: self-hosted LiveSync on this server (returns a Setup URI for devices). official: Obsidian Sync, only with an account already signed in on this server. git: a git repository (returns a deploy key to add to the repo). none: no sync."
      ),
    device_url: z
      .string()
      .max(300)
      .optional()
      .describe("livesync only: the address devices use to reach CouchDB, e.g. https://couchdb.example.com (phones need https). Needed for the first self-hosted LiveSync vault."),
    git_repo: z.string().max(300).optional().describe("git only: the repository URL, e.g. git@github.com:you/vault.git."),
    official_vault: z.string().max(120).optional().describe("official only: the vault's name on the Obsidian Sync account, if it has several."),
    app: z.boolean().optional().describe("Also run the Obsidian app for it (about 350 MB of RAM). Default false."),
  }),
  z.object({ action: z.literal("remove"), vault_id: VaultId }),
  z.object({ action: z.literal("rename"), vault_id: VaultId, name: z.string().min(1).max(120) }),
]);
export const STACK_VAULTS_TOOL = {
  name: "obsidian_stack_vaults",
  description:
    "Add, remove or rename vaults on this server. add sets up the vault's sync and returns what devices need (a Setup URI and passphrase for livesync, a deploy key for git); these are secrets, so share them only with the vault's owner. remove takes the vault out of the stack and stops its sync, but keeps its notes on the server. rename changes the display name only.",
  inputSchema: StackVaultsInput,
};

export const StackSyncInput = z.object({
  action: z.enum(["restart", "logs"]),
  vault_id: VaultId,
  app: z.boolean().optional().describe("The vault's Obsidian app instead of its sync."),
  lines: z.number().int().min(1).max(500).optional().describe("logs: how many recent lines (default 50)."),
});
export const STACK_SYNC_TOOL = {
  name: "obsidian_stack_sync",
  description:
    "A vault's sync on this server: restart it, or read its recent log lines (useful when notes aren't arriving or leaving). With app: true, the vault's Obsidian app instead.",
  inputSchema: StackSyncInput,
};

export const StackAppInput = z.object({
  action: z.enum(["enable", "disable"]),
  vault_id: VaultId,
  plugins: z
    .boolean()
    .optional()
    .describe("enable: also turn off restricted mode, so community plugins in the vault run on the server. Default false."),
});
export const STACK_APP_TOOL = {
  name: "obsidian_stack_app",
  description:
    "Turn the full Obsidian app on or off for a vault on this server. On, it adds the obsidian_app_* tools (plugins, Bases, screenshots) for that vault from the next connection; it costs about 350 MB of RAM, and the first time downloads a 1.3 GB image, which takes a few minutes.",
  inputSchema: StackAppInput,
};

export const StackSetupUriInput = z.object({
  vault_id: VaultId,
  device_url: z
    .string()
    .max(300)
    .optional()
    .describe("Change the address devices use to reach CouchDB (applies to every self-hosted LiveSync vault)."),
});
export const STACK_SETUP_URI_TOOL = {
  name: "obsidian_stack_setup_uri",
  description:
    "A Setup URI and passphrase for adding a device to a self-hosted LiveSync vault. They don't expire and work on any number of devices. Secrets: share only with the vault's owner.",
  inputSchema: StackSetupUriInput,
};

export const STACK_TOOLS = [
  STACK_STATUS_TOOL.name,
  STACK_VAULTS_TOOL.name,
  STACK_SYNC_TOOL.name,
  STACK_APP_TOOL.name,
  STACK_SETUP_URI_TOOL.name,
];

export function managerConfigured(): boolean {
  return Boolean(process.env.OBSIDIAN_MANAGER_TOKEN);
}

async function call(route: string, body: unknown) {
  const token = process.env.OBSIDIAN_MANAGER_TOKEN;
  if (!token) throw new Error("The manager add-on is off on this server (obsidian-stack manager enable).");
  const url = process.env.OBSIDIAN_MANAGER_URL || "http://obsidian-manager:7320";
  let res: Response;
  try {
    res = await fetch(`${url}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      // adding a vault with the Obsidian app can include a 1.3 GB download
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
  } catch {
    throw new Error("Can't reach the manager. Is it running? (obsidian-stack manager status)");
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `The manager returned HTTP ${res.status}.`);
  return data;
}

export const handleStackStatus = () => call("/status", {});
export const handleStackVaults = (i: z.infer<typeof StackVaultsInput>) => call("/vaults", i);
export const handleStackSync = (i: z.infer<typeof StackSyncInput>) => call("/sync", i);
export const handleStackApp = (i: z.infer<typeof StackAppInput>) => call("/app", i);
export const handleStackSetupUri = (i: z.infer<typeof StackSetupUriInput>) => call("/setup_uri", i);
