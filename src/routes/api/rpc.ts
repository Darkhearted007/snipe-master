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
        // Prefer RPCFast (beam) when configured, then fall back to Helius.
        const heliusUrl =
          process.env.HELIUS_RPC_URL ??
          (process.env.HELIUS_API_KEY
            ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
            : null);
        const rpcFastUrl =
          process.env.RPCFAST_HTTP_URL ??
          (process.env.RPCFAST_API_KEY
            ? `https://beam.rpcfast.com/?api_key=${process.env.RPCFAST_API_KEY}`
            : null);
        const upstreams = [rpcFastUrl, heliusUrl].filter(Boolean) as string[];

        if (upstreams.length === 0) {
          return new Response(JSON.stringify({ error: "RPC not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        const body = await request.text();
        let lastDetail = "no upstreams tried";
        for (let i = 0; i < upstreams.length; i++) {
          const url = upstreams[i];
          const isLast = i === upstreams.length - 1;
          try {
            const upstream = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            });
            const text = await upstream.text();
            // If upstream 5xx'd, try the next one; otherwise return.
            if (upstream.status >= 500) {
              lastDetail = `HTTP ${upstream.status} from upstream`;
              continue;
            }
            // Some upstreams (e.g. RPCFast free tier) reject common methods
            // like getBalance with "unsupported method". Fail over to the
            // next upstream instead of returning that error to the client.
            if (!isLast && /"unsupported method"/i.test(text)) {
              lastDetail = "upstream rejected method as unsupported";
              continue;
            }
            return new Response(text, {
              status: upstream.status,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          } catch (e) {
            lastDetail = e instanceof Error ? e.message : String(e);
            continue;
          }
        }
        // All upstreams failed — soft-fail so the wallet adapter can retry.
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "RPC upstream unavailable", data: lastDetail },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          },
        );
      },
    },
  },
});
