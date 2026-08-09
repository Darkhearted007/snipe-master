import { useEffect, useRef } from "react";
import { useBotStore } from "@/lib/bot-store";
import { logStructured } from "@/lib/structured-logger";

/**
 * Safety resolver for the tick() discovery path.
 *
 * The DexScreener stream (use-dexscreener-stream.ts) already fires a safety
 * check for each opportunity it pushes: pushRealOpportunity → fetchSafetyVerdict
 * → applySafetyVerdict. But the tick() path (which reads discoveryCandidates
 * from /api/discovery) creates opportunities with safety = -1 when the
 * candidate's safety_score is null, and never fires a safety check to resolve
 * it — so the opportunity stays at "safety not yet scored" → decision="skip"
 * forever. This was a major cause of the bot skipping 80+ trades without
 * entering one.
 *
 * This hook closes that gap: it watches the opportunity feed for entries that
 * have a mint but haven't been safety-scored yet (safety === -1), and fires
 * the same /api/rugcheck/$mint → applySafetyVerdict flow the DexScreener
 * stream uses.
 *
 * Retries: if a safety check fails (network error, timeout) or returns an
 * "unknown" verdict (both rugcheck and on-chain failed), the hook retries up
 * to MAX_RETRIES times with a delay. This prevents opportunities from being
 * permanently stuck at safety=-1 when the safety endpoint has a transient
 * failure.
 */
const SAFETY_CHECK_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

type SafetyVerdictResponse =
  | {
      ok: true;
      score: number | null;
      verdict: "safe" | "caution" | "danger" | "unknown";
      flags?: {
        lpLocked: boolean | null;
        lpLockedPct: number | null;
        topHolderPct: number | null;
        insiderPct: number | null;
      };
      onChain?: {
        score: number;
        mintAuthorityActive: boolean | null;
        freezeAuthorityActive: boolean | null;
        honeypotSellable: boolean | null;
        lpStatus: string;
        reasons: string[];
      } | null;
    }
  | { ok: false; error: string };

async function fetchSafetyVerdict(
  mint: string,
  signal: AbortSignal,
): Promise<{
  score: number | null;
  verdict: "safe" | "caution" | "danger" | "unknown";
  flags?: {
    lpLocked: boolean | null;
    topHolderPct: number | null;
    honeypotSellable: boolean | null;
  };
}> {
  const res = await fetch(`/api/rugcheck/${encodeURIComponent(mint)}`, { signal });
  if (!res.ok) throw new Error(`safety check ${res.status}`);
  const data = (await res.json()) as SafetyVerdictResponse;
  if (!data.ok) throw new Error(data.error);
  return {
    score: data.score,
    verdict: data.verdict,
    flags: {
      lpLocked: data.flags?.lpLocked ?? null,
      topHolderPct: data.flags?.topHolderPct ?? null,
      honeypotSellable: data.onChain?.honeypotSellable ?? null,
    },
  };
}

export function useSafetyResolver(enabled: boolean) {
  const applySafetyVerdict = useBotStore((s) => s.applySafetyVerdict);
  const checkedRef = useRef<Set<string>>(new Set());
  const attemptRef = useRef<Map<string, number>>(new Map());
  const controllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const controllers = controllersRef.current;
    const attempts = attemptRef.current;

    const checkOpportunity = (o: {
      id: string;
      token: string;
      mint?: string;
      tokenAddress?: string | null;
    }) => {
      const mint = o.mint ?? o.tokenAddress ?? null;
      if (!mint) return;

      const attempt = (attempts.get(o.id) ?? 0) + 1;
      attempts.set(o.id, attempt);
      checkedRef.current.add(o.id);

      const controller = new AbortController();
      controllers.add(controller);
      const to = setTimeout(() => controller.abort(), SAFETY_CHECK_TIMEOUT_MS);

      fetchSafetyVerdict(mint, controller.signal)
        .then((v) => {
          applySafetyVerdict({
            opportunityId: o.id,
            score: v.score,
            verdict: v.verdict,
            flags: v.flags,
          });
          // If the verdict is "unknown" (both rugcheck and on-chain failed),
          // retry after a delay — but only up to MAX_RETRIES.
          if (v.verdict === "unknown" && attempt < MAX_RETRIES) {
            checkedRef.current.delete(o.id); // allow re-check
            setTimeout(() => {
              if (useBotStore.getState().status === "running") {
                checkOpportunity(o);
              }
            }, RETRY_DELAY_MS);
          }
        })
        .catch((e) => {
          logStructured(e, {
            category: "stream",
            severity: "info",
            silent: true,
            userMessage: `Safety check failed for ${o.token}`,
            context: { mint, attempt },
          });
          // Retry on failure (network error, timeout) up to MAX_RETRIES.
          if (attempt < MAX_RETRIES) {
            checkedRef.current.delete(o.id); // allow re-check
            setTimeout(() => {
              if (useBotStore.getState().status === "running") {
                checkOpportunity(o);
              }
            }, RETRY_DELAY_MS);
          }
        })
        .finally(() => {
          clearTimeout(to);
          controllers.delete(controller);
        });
    };

    const unsub = useBotStore.subscribe((state) => {
      if (state.status !== "running") return;

      // Find unscored opportunities that have a mint and haven't been
      // checked yet (or whose check failed and are eligible for retry).
      // These come from the tick() path when discovery candidates don't
      // include a safety_score.
      const pending = state.opportunities.filter(
        (o) => o.safety === -1 && (o.mint || o.tokenAddress) && !checkedRef.current.has(o.id),
      );

      if (!pending.length) return;

      for (const o of pending) {
        checkOpportunity(o);
      }
    });

    return () => {
      unsub();
      // Abort any in-flight safety checks when the hook unmounts/disables.
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, [enabled, applySafetyVerdict]);

  // Clean up the checked set and attempt counts when the bot stops so a
  // restart re-checks everything fresh.
  const status = useBotStore((s) => s.status);
  useEffect(() => {
    if (status === "idle") {
      checkedRef.current.clear();
      attemptRef.current.clear();
    }
  }, [status]);
}
