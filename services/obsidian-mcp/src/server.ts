// obsidian-mcp — typed MCP over obsidian-api, for every vault in the registry.
// Port 7002.
//
// This file is config + startup checks; the tool set lives in vault-tools.ts,
// vault discovery and per-vault contexts in lib/connections.ts, and the HTTP
// transport and schema conversion in lib/transport.ts and lib/schema.ts.

import { startMcp } from "./lib/transport.js";
import { VaultConnections } from "./lib/connections.js";
import { ObsidianError } from "./obsidian-client.js";
import { obsidianTools } from "./vault-tools.js";

const PORT = parseInt(process.env.PORT || "7002", 10);
const OBSIDIAN_BASE_URL = process.env.OBSIDIAN_BASE_URL || "http://obsidian-api:3000";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiKey = process.env.OBSIDIAN_API_KEY;
if (!apiKey) { console.error("FATAL: OBSIDIAN_API_KEY env var required"); process.exit(1); }

const maxAttachmentBytes = parseInt(process.env.OBSIDIAN_MAX_ATTACHMENT_BYTES || String(10 * 1024 * 1024), 10);
if (!Number.isSafeInteger(maxAttachmentBytes) || maxAttachmentBytes <= 0) {
  console.error("FATAL: OBSIDIAN_MAX_ATTACHMENT_BYTES must be a positive integer");
  process.exit(1);
}

const timeZone = process.env.OBSIDIAN_TIMEZONE || "UTC";
try {
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
} catch {
  console.error(`FATAL: invalid OBSIDIAN_TIMEZONE: ${timeZone}`);
  process.exit(1);
}

const connections = new VaultConnections(OBSIDIAN_BASE_URL, apiKey);

// The API may still be starting; give it ~30s before giving up. Zero vaults is
// fine here — they can be added later without restarting the MCP.
for (let attempt = 1; ; attempt++) {
  try {
    const vaults = await connections.list();
    console.log(`obsidian connectivity: ok (${OBSIDIAN_BASE_URL}, ${vaults.length} vault${vaults.length === 1 ? "" : "s"})`);
    break;
  } catch (e: any) {
    if (attempt >= 60) {
      console.error(`obsidian connectivity FAILED at ${OBSIDIAN_BASE_URL}:`, e.message);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// OAuth is opt-in. Set MCP_OAUTH_ISSUER + MCP_OAUTH_CANONICAL_URL to enable.
// The static bearer token keeps working either way.
const oauth = process.env.MCP_OAUTH_ISSUER
  ? {
      issuer: process.env.MCP_OAUTH_ISSUER,
      canonicalUrl: process.env.MCP_OAUTH_CANONICAL_URL!,
      jwksUri: process.env.MCP_OAUTH_JWKS_URI || undefined,
      audience: process.env.MCP_OAUTH_AUDIENCE || undefined,
      scopesSupported: (process.env.MCP_OAUTH_SCOPES || "openid email profile offline_access").split(/\s+/),
    }
  : undefined;

await startMcp({
  name: "obsidian-mcp",
  version: "2.0.0",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  instructions:
    "Server-side Obsidian vaults. Call obsidian_list_vaults first and pass an explicit vault_id to every other tool. " +
    "Read Home.md when present before choosing where to write. " +
    "Prefer focused tools over deprecated compatibility tools; use expected_hash for read-modify-write work and dry_run for broad changes.",
  tools: obsidianTools(connections),
  onBackendError: (e) => {
    if (e instanceof ObsidianError) {
      const detail = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
      return `obsidian API error: ${e.method} ${e.path} → HTTP ${e.status}: ${detail}`;
    }
    return null;
  },
});
