// Proxy to rugcheck.xyz's free Solana token risk API.
// Returns a summarized safety verdict: score, risks[], and derived flags
// (mintAuthority, freezeAuthority, LP-locked, top holder concentration).
//
// Placed under /api/ (not /api/public/) so it inherits the app's default
// same-origin behavior. External callers don't need this endpoint.
import { createFileRoute } from "@tanstack/react-router";
import { evaluateMintSafety } from "@/lib/onchain-safety";

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
  ok: true;
  score: number | null; // 0-100 (higher = safer, after inversion of rugcheck raw)
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
  // Independent, ground-truth signal from direct Solana RPC + a real
  // Jupiter round-trip quote — not another aggregator's report. Present
  // whenever the on-chain check completes, regardless of whether rugcheck's
  // upstream succeeded, so a rugcheck outage never means "no safety data at
  // all". A hard on-chain failure (active mint/freeze authority, or a
  // failed honeypot sell-probe) can only pull the combined verdict toward
  // "danger" — it never gets overridden by a rosier external report.
  onChain: {
    score: number;
    mintAuthorityActive: boolean | null;
    freezeAuthorityActive: boolean | null;
    honeypotSellable: boolean | null;
    lpStatus: string;
    reasons: string[];
  } | null;
  risks: Array<{ name: string; level: string; description?: string }>;
  verdict: "safe" | "caution" | "danger" | "unknown";
};

function summarize(
  mint: string,
  r: RugcheckReport,
  onChain: SafetyVerdict["onChain"],
): SafetyVerdict {
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

  // Combined score: the more conservative (lower) of rugcheck's score and
  // the on-chain score, when both are available. If rugcheck is down but
  // on-chain succeeded, on-chain alone still produces a real verdict rather
  // than falling back to "unknown".
  const combinedScore =
    score != null && onChain != null ? Math.min(score, onChain.score) : (onChain?.score ?? score);

  // A hard on-chain red flag forces "danger" regardless of what rugcheck's
  // aggregated score says — ground truth overrides a third party's report.
  //
  // IMPORTANT: active mint/freeze authority is ONLY a hard fail for tokens
  // that have already migrated to an AMM (Raydium, Orca, etc.) where a
  // separate LP mint exists. Pump.fun bonding-curve tokens (lpStatus ===
  // "not-applicable") ALWAYS have active mint/freeze authority pre-migration
  // — this is structurally normal and NOT a rug signal. Treating it as one
  // (as the original code did) caused every pump.fun token to get a "danger"
  // verdict, which is why the bot skipped 80+ trades without entering one.
  //
  // The one on-chain signal that IS a hard fail regardless of venue: a
  // confirmed honeypot (honeypotSellable === false) — the token literally
  // cannot be sold, so funds would be locked forever.
  const isPumpFunBondingCurve = onChain != null && onChain.lpStatus === "not-applicable";
  const onChainHardFail =
    onChain != null &&
    (onChain.honeypotSellable === false ||
      (!isPumpFunBondingCurve &&
        (onChain.mintAuthorityActive === true || onChain.freezeAuthorityActive === true)));

  const verdict: SafetyVerdict["verdict"] = onChainHardFail
    ? "danger"
    : combinedScore == null
      ? "unknown"
      : dangerCount > 0 || combinedScore < 40
        ? "danger"
        : combinedScore < 70
          ? "caution"
          : "safe";

  return {
    mint,
    fetchedAt: Date.now(),
    ok: true,
    score: combinedScore,
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
    onChain,
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
        const [rugcheckResult, onChainResult] = await Promise.allSettled([
          fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, {
            headers: { accept: "application/json" },
          }).then(async (res) => {
            if (!res.ok) throw new Error(`rugcheck upstream ${res.status}`);
            return (await res.json()) as RugcheckReport;
          }),
          evaluateMintSafety(mint, null),
        ]);

        const onChain: SafetyVerdict["onChain"] =
          onChainResult.status === "fulfilled"
            ? {
                score: onChainResult.value.score,
                mintAuthorityActive: onChainResult.value.authority.mintAuthorityActive,
                freezeAuthorityActive: onChainResult.value.authority.freezeAuthorityActive,
                honeypotSellable: onChainResult.value.honeypot.sellable,
                lpStatus: onChainResult.value.lpStatus.lpStatus,
                reasons: onChainResult.value.reasons,
              }
            : null;
        if (onChainResult.status === "rejected") {
          console.error("[rugcheck] on-chain evaluation failed", mint, onChainResult.reason);
        }

        if (rugcheckResult.status === "rejected") {
          if (!onChain) {
            // Both signals failed — genuinely nothing to report.
            const detail =
              rugcheckResult.reason instanceof Error
                ? rugcheckResult.reason.message
                : String(rugcheckResult.reason);
            return new Response(
              JSON.stringify({ ok: false, mint, error: "safety checks unavailable", detail }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
            );
          }
          // rugcheck failed but on-chain succeeded — still return a real
          // verdict built from on-chain data alone rather than "unknown".
          const verdict = summarize(mint, {}, onChain);
          return new Response(JSON.stringify(verdict), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        const verdict = summarize(mint, rugcheckResult.value, onChain);
        return new Response(JSON.stringify(verdict), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            // 60s edge cache so re-checks are cheap
            "Cache-Control": "public, max-age=60, s-maxage=60",
            ...CORS,
          },
        });
      },
    },
  },
});

export type { SafetyVerdict };
