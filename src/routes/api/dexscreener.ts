import { createFileRoute } from "@tanstack/react-router";

// DexScreener REST proxy with in-memory cache + stale-while-error fallback.
// The user pasted `wss://` URLs but DexScreener actually exposes REST endpoints
// under https://api.dexscreener.com. We poll them server-side (avoids CORS +
// hides any key) and let the client subscribe via useQuery with a refetch
// interval.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const ALLOWED = new Set([
  "token-profiles/latest/v1",
  "token-profiles/recent-updates/v1",
  "token-boosts/latest/v1",
  "token-boosts/top/v1",
  "community-takeovers/latest/v1",
  "ads/latest/v1",
]);

const TTL_MS = 15_000;
const cache = new Map<
  string,
  { at: number; status: number; body: string }
>();

export const Route = createFileRoute("/api/dexscreener")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const feed = url.searchParams.get("feed") ?? "";
        if (!ALLOWED.has(feed)) {
          return new Response(
            JSON.stringify({ error: "Unknown feed", allowed: [...ALLOWED] }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }

        const now = Date.now();
        const cached = cache.get(feed);
        if (cached && now - cached.at < TTL_MS) {
          return new Response(cached.body, {
            status: cached.status,
            headers: {
              "Content-Type": "application/json",
              "X-Cache": "HIT",
              ...CORS,
            },
          });
        }

        try {
          const upstream = await fetch(
            `https://api.dexscreener.com/${feed}`,
            { headers: { accept: "application/json" } },
          );
          const text = await upstream.text();
          cache.set(feed, { at: now, status: upstream.status, body: text });
          return new Response(text, {
            status: upstream.status,
            headers: {
              "Content-Type": "application/json",
              "X-Cache": "MISS",
              ...CORS,
            },
          });
        } catch (e) {
          // Network disruption → serve last-good copy so the bot doesn't stop
          if (cached) {
            return new Response(cached.body, {
              status: cached.status,
              headers: {
                "Content-Type": "application/json",
                "X-Cache": "STALE",
                ...CORS,
              },
            });
          }
          const detail = e instanceof Error ? e.message : String(e);
          return new Response(
            JSON.stringify({ error: "Upstream unavailable", detail }),
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
