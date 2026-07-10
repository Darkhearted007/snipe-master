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
        const base = key
          ? "https://api.jup.ag/swap/v1/swap"
          : "https://quote-api.jup.ag/v6/swap";
        try {
          const upstream = await fetch(base, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              accept: "application/json",
              ...(key ? { "x-api-key": key } : {}),
            },
            body: JSON.stringify({
              quoteResponse: b.quoteResponse,
              userPublicKey: b.userPublicKey,
              wrapAndUnwrapSol: b.wrapUnwrapSOL !== false,
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: "auto",
            }),
          });
          const text = await upstream.text();
          return new Response(text, {
            status: upstream.status,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return new Response(
            JSON.stringify({ error: "Swap upstream unavailable", detail }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },
    },
  },
});
