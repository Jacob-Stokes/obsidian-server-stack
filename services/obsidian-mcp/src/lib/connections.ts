import { ObsidianClient } from "../obsidian-client.js";
import { type ToolContext, VaultPolicy } from "./vault.js";

const SOURCES = ["livesync", "livesync-existing", "official", "git", "none"] as const;
export type VaultConnection = {
  id: string;
  name: string;
  source: (typeof SOURCES)[number];
  scopePath: string;
  /** The optional Obsidian app add-on (extras/obsidian-app) is on for this vault. */
  app: boolean;
};

/** Where a vault's Obsidian app add-on listens, and how to authenticate to it. */
export type AppTarget = { vault: VaultConnection; url: string; token: string };

export class VaultConnections {
  private readonly discovery: ObsidianClient;
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {
    this.discovery = new ObsidianClient(baseUrl, apiKey);
  }

  async list(query = ""): Promise<VaultConnection[]> {
    const result = await this.discovery.get("/api/vaults");
    if (!Array.isArray(result?.vaults)) throw new Error("The app did not return a vault inventory.");
    const vaults: VaultConnection[] = result.vaults;
    for (const vault of vaults) {
      if (
        !/^[a-z][a-z0-9-]{0,62}$/.test(vault.id) ||
        typeof vault.name !== "string" ||
        !SOURCES.includes(vault.source) ||
        typeof vault.scopePath !== "string" ||
        !vault.scopePath.trim() ||
        (vault.app !== undefined && typeof vault.app !== "boolean")
      ) {
        throw new Error("The app returned an invalid vault inventory.");
      }
      vault.app = vault.app === true;
    }
    const normalized = query.trim().toLocaleLowerCase();
    return vaults.filter(
      (vault) => !normalized || vault.name.toLocaleLowerCase().includes(normalized) || vault.id.includes(normalized)
    );
  }

  // With no id, use the only vault if there is exactly one. With several,
  // refuse rather than guess, and name them so the caller can retry without
  // a separate list call. Re-checked on every call, so adding a second vault
  // mid-session makes id-less calls fail closed instead of picking one.
  async context(id?: string): Promise<ToolContext> {
    const vault = await this.resolve(id);
    const policy = new VaultPolicy(vault.scopePath);
    return {
      client: new ObsidianClient(this.baseUrl, this.apiKey, { id: vault.id, scopePath: vault.scopePath }),
      policy,
      dailyFolder: policy.resolveDefaultPath(process.env.OBSIDIAN_DAILY_FOLDER || "Journal"),
      timeZone: process.env.OBSIDIAN_TIMEZONE || "UTC",
      maxAttachmentBytes: parseInt(process.env.OBSIDIAN_MAX_ATTACHMENT_BYTES || String(10 * 1024 * 1024), 10)
    };
  }

  // The vault's Obsidian app add-on. Same id rules as context(); refuses
  // vaults without the add-on, naming the ones that have it.
  async app(id?: string): Promise<AppTarget> {
    const vault = await this.resolve(id, (v) => v.app);
    const token = process.env.OBSIDIAN_APP_TOKEN || "";
    if (!token) throw new Error("The Obsidian app add-on isn't configured on this server (no OBSIDIAN_APP_TOKEN).");
    const host = `${process.env.OBSIDIAN_APP_HOST_PREFIX || ""}obsidian-${vault.id}-app`;
    return { vault, url: `http://${host}:7310`, token };
  }

  private async resolve(id?: string, require?: (v: VaultConnection) => boolean): Promise<VaultConnection> {
    let vaults = await this.list();
    if (require) {
      const all = vaults;
      vaults = vaults.filter(require);
      if (id && all.some((v) => v.id === id) && !vaults.some((v) => v.id === id)) {
        const others = vaults.map((v) => v.id).join(", ") || "none";
        throw new Error(`The Obsidian app add-on isn't enabled for '${id}'. Vaults with it: ${others}.`);
      }
      if (vaults.length === 0) throw new Error("No vault on this server has the Obsidian app add-on enabled.");
    }
    let vault: VaultConnection | undefined;
    if (id === undefined || id === "") {
      if (vaults.length === 1) vault = vaults[0];
      else if (vaults.length === 0) throw new Error("This server has no vaults yet. Add one with: obsidian-stack add");
      else {
        const options = vaults.map((v) => `${v.id} (${v.name})`).join(", ");
        throw new Error(`This server has ${vaults.length} vaults, so vault_id is required: ${options}.`);
      }
    } else {
      if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) throw new Error("Choose vault_id from obsidian_list_vaults.");
      vault = vaults.find((candidate) => candidate.id === id);
      if (!vault) throw new Error("Vault connection is unavailable or not permitted.");
    }
    return vault;
  }
}
