import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const MAX_SLIPPAGE_BPS = 500; // 5% hard cap

export const Route = createFileRoute("/api/jupiter/quote")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const inputMint = url.searchParams.get("inputMint");
        const outputMint = url.searchParams.get("outputMint");
        const amount = url.searchParams.get("amount");
        const slippage = Math.min(
          MAX_SLIPPAGE_BPS,
          Math.max(1, Number(url.searchParams.get("slippageBps") ?? "50")),
        );
        if (!inputMint || !outputMint || !amount || !/^\d+$/.test(amount)) {
          return new Response(JSON.stringify({ error: "inputMint, outputMint, amount required" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount,
          slippageBps: String(slippage),
          restrictIntermediateTokens: "true",
        });
        const key = process.env.JUPITER_API_KEY;
        const API_BASE = "https://api.jup.ag/swap/v1/quote";
        const LEGACY_BASE = "https://quote-api.jup.ag/v6/quote";

        // Prefer api.jup.ag (keyed when JUPITER_API_KEY is set — it also
        // answers keyless on most networks), then keyless api.jup.ag, then
        // the legacy quote-api as a last resort (progressively deprecated).
        const upstreams: Array<{ url: string; headers: Record<string, string> }> = [
          {
            url: API_BASE,
            headers: key
              ? { "x-api-key": key, accept: "application/json" }
              : { accept: "application/json" },
          },
          { url: API_BASE, headers: { accept: "application/json" } },
          { url: LEGACY_BASE, headers: { accept: "application/json" } },
        ];
        let lastDetail = "no upstreams tried";
        for (const upstream of upstreams) {
          try {
            const res = await fetch(`${upstream.url}?${params.toString()}`, {
              headers: upstream.headers,
            });
            if (!res.ok) {
              lastDetail = `HTTP ${res.status} from ${upstream.url}`;
              continue;
            }
            const text = await res.text();
            return new Response(text, {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          } catch (e) {
            lastDetail = e instanceof Error ? e.message : String(e);
            continue;
          }
        }
        return new Response(
          JSON.stringify({ error: "Quote upstream unavailable", detail: lastDetail }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          },
        );
      },
    },
  },
});
