// Server-only. Talks directly to Helius using the same env vars as
// /api/rpc.ts, since safety checks run inside the webhook handler rather
// than through the browser-facing proxy.

export async function rpcRequest<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const rpcFastUrl =
    process.env.RPCFAST_HTTP_URL ??
    (process.env.RPCFAST_API_KEY
      ? `https://beam.rpcfast.com/?api_key=${process.env.RPCFAST_API_KEY}`
      : null);
  const heliusUrl =
    process.env.HELIUS_RPC_URL ??
    (process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : null);
  const upstreams = [rpcFastUrl, heliusUrl].filter(Boolean) as string[];
  if (upstreams.length === 0) {
    throw new Error("RPC not configured (RPCFAST_* or HELIUS_* missing)");
  }

  let lastError: Error | null = null;
  for (const url of upstreams) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: `${method}-${Date.now()}`, method, params }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        result?: T;
        error?: { message?: string };
      };
      if (!res.ok) {
        lastError = new Error(body.error?.message ?? `RPC HTTP ${res.status}`);
        continue;
      }
      if (body.error) {
        lastError = new Error(body.error.message ?? `RPC ${method} failed`);
        continue;
      }
      return body.result as T;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      continue;
    }
  }
  throw lastError ?? new Error(`RPC ${method} failed on all upstreams`);
}
