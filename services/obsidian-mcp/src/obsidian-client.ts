// Client for obsidian-api. Vault selection is explicit: each context carries
// the vault id and the scope it was granted, sent as headers on every call.

const TIMEOUT_MS = 10_000;

export class ObsidianClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly vault?: { id: string; scopePath: string }
  ) {}

  async call(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<any> {
    const prefix = process.env.OBSIDIAN_API_PREFIX ?? "";
    const backendPath = path.startsWith("/api/") ? `${prefix}${path.slice(4)}` : path;
    const url = `${this.baseUrl}${backendPath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": contentType,
          ...(this.vault ? { "X-Obsidian-Vault-Id": this.vault.id, "X-Obsidian-Scope": this.vault.scopePath } : {})
        },
        body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (method === "HEAD" && res.ok) {
        return {
          exists: true,
          size: numberHeader(res.headers.get("x-size")),
          modified: res.headers.get("x-modified") ?? undefined,
          type: res.headers.get("x-type") ?? undefined
        };
      }
      if (res.status === 204) return null;
      const text = await res.text();
      if (!res.ok) {
        let detail: any;
        try {
          detail = JSON.parse(text);
        } catch {
          detail = text;
        }
        throw new ObsidianError(res.status, detail, method, path);
      }
      // Some endpoints return non-JSON (file content as text). Try JSON first.
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return text;
      }
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        throw new ObsidianError(0, `timeout after ${TIMEOUT_MS}ms`, method, path);
      }
      throw e;
    }
  }

  get(path: string): Promise<any> {
    return this.call("GET", path);
  }
  post(path: string, body?: unknown): Promise<any> {
    return this.call("POST", path, body);
  }
  put(path: string, body?: unknown): Promise<any> {
    return this.call("PUT", path, body);
  }
  delete(path: string): Promise<any> {
    return this.call("DELETE", path);
  }
  head(path: string): Promise<any> {
    return this.call("HEAD", path);
  }
}

function numberHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// URL-encode a vault path while preserving forward slashes (obsidian-api's
// routing uses path segments). Each segment is encoded individually.
export function encodeVaultPath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export class ObsidianError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: any,
    public readonly method: string,
    public readonly path: string
  ) {
    const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail);
    super(`obsidian ${method} ${path} → ${status}: ${detailStr}`);
  }
}
