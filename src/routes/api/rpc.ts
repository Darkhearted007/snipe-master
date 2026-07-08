import { createFileRoute } from "@tanstack/react-router";

// Helius Solana JSON-RPC proxy. Keeps the API key server-side only.
// The wallet adapter's ConnectionProvider talks to /api/rpc from the browser.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Solana-Client",
  "Access-Control-Max-Age": "86400",
} as const;

export const Route = createFileRoute("/api/rpc")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const upstreamUrl =
          process.env.HELIUS_RPC_URL ??
          (process.env.HELIUS_API_KEY
            ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
            : null);

        if (!upstreamUrl) {
          return new Response(
            JSON.stringify({ error: "RPC not configured" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }

        const body = await request.text();
        try {
          const upstream = await fetch(upstreamUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          const text = await upstream.text();
          return new Response(text, {
            status: upstream.status,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          // Never 5xx-hard so the wallet adapter can keep retrying with backoff
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "RPC upstream unavailable", data: detail },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }
      },
    },
  },
});
