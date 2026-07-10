// Proxy to rugcheck.xyz's free Solana token risk API.
// Returns a summarized safety verdict: score, risks[], and derived flags
// (mintAuthority, freezeAuthority, LP-locked, top holder concentration).
//
// Placed under /api/ (not /api/public/) so it inherits the app's default
// same-origin behavior. External callers don't need this endpoint.
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

type Risk = { name?: string; description?: string; level?: string; score?: number };
type RugcheckReport = {
  score?: number;
  risks?: Risk[];
  tokenMeta?: { name?: string; symbol?: string };
  token?: {
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
    supply?: number;
    decimals?: number;
  };
  topHolders?: Array<{ address?: string; pct?: number; insider?: boolean }>;
  markets?: Array<{ liquidityA?: number; lp?: { lpLocked?: boolean; lpLockedPct?: number } }>;
};

type SafetyVerdict = {
  mint: string;
  fetchedAt: number;
  ok: boolean;
  score: number | null; // 0-100 (rugcheck's own — higher = safer here after inversion)
  rawScore: number | null; // rugcheck raw
  symbol: string | null;
  name: string | null;
  flags: {
    mintAuthorityRevoked: boolean;
    freezeAuthorityRevoked: boolean;
    lpLocked: boolean | null;
    lpLockedPct: number | null;
    topHolderPct: number | null;
    insiderPct: number | null;
  };
  risks: Array<{ name: string; level: string; description?: string }>;
  verdict: "safe" | "caution" | "danger" | "unknown";
};

function summarize(mint: string, r: RugcheckReport): SafetyVerdict {
  const risks =
    r.risks?.map((x) => ({
      name: x.name ?? "unknown",
      level: (x.level ?? "info").toLowerCase(),
      description: x.description,
    })) ?? [];

  const topHolders = r.topHolders ?? [];
  const nonInsiderTop = topHolders.filter((h) => !h.insider);
  const topHolderPct = nonInsiderTop[0]?.pct ?? null;
  const insiderPct =
    topHolders.filter((h) => h.insider).reduce((s, h) => s + (h.pct ?? 0), 0) || null;

  const lp = r.markets?.[0]?.lp;
  const lpLocked = lp?.lpLocked ?? null;
  const lpLockedPct = lp?.lpLockedPct ?? null;

  const mintAuthorityRevoked = r.token?.mintAuthority == null;
  const freezeAuthorityRevoked = r.token?.freezeAuthority == null;

  // Normalize rugcheck's raw score (0 = safest, higher = riskier) into 0-100
  // safety score (higher = safer). Cap at 500 raw ~ 0 safety.
  const rawScore = typeof r.score === "number" ? r.score : null;
  const score =
    rawScore == null ? null : Math.max(0, Math.min(100, Math.round(100 - rawScore / 5)));

  const dangerCount = risks.filter((x) => x.level === "danger" || x.level === "high").length;
  const verdict: SafetyVerdict["verdict"] =
    score == null
      ? "unknown"
      : dangerCount > 0 || score < 40
        ? "danger"
        : score < 70
          ? "caution"
          : "safe";

  return {
    mint,
    fetchedAt: Date.now(),
    ok: true,
    score,
    rawScore,
    symbol: r.tokenMeta?.symbol ?? null,
    name: r.tokenMeta?.name ?? null,
    flags: {
      mintAuthorityRevoked,
      freezeAuthorityRevoked,
      lpLocked,
      lpLockedPct,
      topHolderPct,
      insiderPct,
    },
    risks,
    verdict,
  };
}

export const Route = createFileRoute("/api/rugcheck/$mint")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ params }) => {
        const mint = params.mint?.trim();
        // Solana base58 mints are 32-44 chars.
        if (!mint || mint.length < 32 || mint.length > 64) {
          return new Response(JSON.stringify({ ok: false, error: "invalid mint" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        try {
          const upstream = await fetch(
            `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,
            { headers: { accept: "application/json" } },
          );
          if (!upstream.ok) {
            return new Response(
              JSON.stringify({
                ok: false,
                mint,
                error: `rugcheck upstream ${upstream.status}`,
              }),
              {
                status: 200, // degrade gracefully; caller shows "unknown" verdict
                headers: { "Content-Type": "application/json", ...CORS },
              },
            );
          }
          const json = (await upstream.json()) as RugcheckReport;
          const verdict = summarize(mint, json);
          return new Response(JSON.stringify(verdict), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              // 60s edge cache so re-checks are cheap
              "Cache-Control": "public, max-age=60, s-maxage=60",
              ...CORS,
            },
          });
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          return new Response(
            JSON.stringify({ ok: false, mint, error: "rugcheck unavailable", detail }),
            { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
          );
        }
      },
    },
  },
});

export type { SafetyVerdict };
