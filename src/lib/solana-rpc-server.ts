// Server-only. Talks directly to Helius using the same env vars as
// /api/rpc.ts, since safety checks run inside the webhook handler rather
// than through the browser-facing proxy.

export async function rpcRequest<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const upstreamUrl =
    process.env.HELIUS_RPC_URL ??
    (process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : null);
  if (!upstreamUrl) throw new Error("RPC not configured (HELIUS_RPC_URL/HELIUS_API_KEY missing)");

  const res = await fetch(upstreamUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `${method}-${Date.now()}`, method, params }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    result?: T;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `RPC HTTP ${res.status}`);
  if (body.error) throw new Error(body.error.message ?? `RPC ${method} failed`);
  return body.result as T;
}
