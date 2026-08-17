import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

// Body: { quoteResponse, userPublicKey, wrapUnwrapSOL? }
export const Route = createFileRoute("/api/jupiter/swap")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        const b = body as {
          quoteResponse?: unknown;
          userPublicKey?: unknown;
          wrapUnwrapSOL?: unknown;
        };
        if (!b.quoteResponse || typeof b.userPublicKey !== "string") {
          return new Response(
            JSON.stringify({ error: "quoteResponse and userPublicKey required" }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
        const key = process.env.JUPITER_API_KEY;
        const API_BASE = "https://api.jup.ag/swap/v1/swap";
        const LEGACY_BASE = "https://quote-api.jup.ag/v6/swap";
        const payload = JSON.stringify({
          quoteResponse: b.quoteResponse,
          userPublicKey: b.userPublicKey,
          wrapAndUnwrapSol: b.wrapUnwrapSOL !== false,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        });

        // Prefer api.jup.ag (keyed when JUPITER_API_KEY is set — it also
        // answers keyless on most networks), then keyless api.jup.ag, then
        // the legacy quote-api as a last resort (progressively deprecated).
        const upstreams: Array<{ url: string; headers: Record<string, string> }> = [
          {
            url: API_BASE,
            headers: key
              ? { "Content-Type": "application/json", accept: "application/json", "x-api-key": key }
              : { "Content-Type": "application/json", accept: "application/json" },
          },
          { url: API_BASE, headers: { "Content-Type": "application/json", accept: "application/json" } },
          { url: LEGACY_BASE, headers: { "Content-Type": "application/json", accept: "application/json" } },
        ];
        let lastDetail = "no upstreams tried";
        for (const upstream of upstreams) {
          try {
            const res = await fetch(upstream.url, {
              method: "POST",
              headers: upstream.headers,
              body: payload,
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
          JSON.stringify({ error: "Swap upstream unavailable", detail: lastDetail }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          },
        );
      },
    },
  },
});
