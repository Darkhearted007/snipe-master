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
          return new Response(
            JSON.stringify({ error: "inputMint, outputMint, amount required" }),
            { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount,
          slippageBps: String(slippage),
          restrictIntermediateTokens: "true",
        });
        const key = process.env.JUPITER_API_KEY;
        const base = key
          ? "https://api.jup.ag/swap/v1/quote"
          : "https://quote-api.jup.ag/v6/quote";
        try {
          const upstream = await fetch(`${base}?${params.toString()}`, {
            headers: key
              ? { "x-api-key": key, accept: "application/json" }
              : { accept: "application/json" },
          });
          const text = await upstream.text();
          return new Response(text, {
            status: upstream.status,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return new Response(
            JSON.stringify({ error: "Quote upstream unavailable", detail }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },
    },
  },
});
