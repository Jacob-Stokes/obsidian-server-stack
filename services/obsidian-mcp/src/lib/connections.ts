import { ObsidianClient } from "../obsidian-client.js";
import { type ToolContext, VaultPolicy } from "./vault.js";

const SOURCES = ["livesync", "livesync-existing", "official", "git", "none"] as const;
export type VaultConnection = { id: string; name: string; source: (typeof SOURCES)[number]; scopePath: string };

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
        !vault.scopePath.trim()
      ) {
        throw new Error("The app returned an invalid vault inventory.");
      }
    }
    const normalized = query.trim().toLocaleLowerCase();
    return vaults.filter(
      (vault) => !normalized || vault.name.toLocaleLowerCase().includes(normalized) || vault.id.includes(normalized)
    );
  }

  async context(id: string): Promise<ToolContext> {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) throw new Error("Choose vault_id from obsidian_list_vaults.");
    const vault = (await this.list()).find((candidate) => candidate.id === id);
    if (!vault) throw new Error("Vault connection is unavailable or not permitted.");
    const policy = new VaultPolicy(vault.scopePath);
    return {
      client: new ObsidianClient(this.baseUrl, this.apiKey, { id: vault.id, scopePath: vault.scopePath }),
      policy,
      dailyFolder: policy.resolveDefaultPath(process.env.OBSIDIAN_DAILY_FOLDER || "Journal"),
      timeZone: process.env.OBSIDIAN_TIMEZONE || "UTC",
      maxAttachmentBytes: parseInt(process.env.OBSIDIAN_MAX_ATTACHMENT_BYTES || String(10 * 1024 * 1024), 10)
    };
  }
}
