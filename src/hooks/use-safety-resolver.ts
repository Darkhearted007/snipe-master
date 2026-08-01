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
 * have a mint but haven't been safety-scored yet (safety === -1, no verdict),
 * and fires the same /api/rugcheck/$mint → applySafetyVerdict flow the
 * DexScreener stream uses. Deduplication via a Set ensures each opportunity
 * is only checked once.
 */
const SAFETY_CHECK_TIMEOUT_MS = 15_000;

type SafetyVerdictResponse =
  | { ok: true; score: number | null; verdict: "safe" | "caution" | "danger" | "unknown" }
  | { ok: false; error: string };

async function fetchSafetyVerdict(
  mint: string,
  signal: AbortSignal,
): Promise<{ score: number | null; verdict: "safe" | "caution" | "danger" | "unknown" }> {
  const res = await fetch(`/api/rugcheck/${encodeURIComponent(mint)}`, { signal });
  if (!res.ok) throw new Error(`safety check ${res.status}`);
  const data = (await res.json()) as SafetyVerdictResponse;
  if (!data.ok) throw new Error(data.error);
  return { score: data.score, verdict: data.verdict };
}

export function useSafetyResolver(enabled: boolean) {
  const applySafetyVerdict = useBotStore((s) => s.applySafetyVerdict);
  const logAudit = useBotStore((s) => s.logAudit);
  const checkedRef = useRef<Set<string>>(new Set());
  const controllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const controllers = controllersRef.current;

    const unsub = useBotStore.subscribe((state) => {
      if (state.status !== "running") return;

      // Find unscored opportunities that have a mint and haven't been
      // checked yet. These come from the tick() path when discovery
      // candidates don't include a safety_score.
      const pending = state.opportunities.filter(
        (o) =>
          o.safety === -1 &&
          !o.verdict &&
          !o.safetyScore &&
          (o.mint || o.tokenAddress) &&
          !checkedRef.current.has(o.id),
      );

      if (!pending.length) return;

      for (const o of pending) {
        checkedRef.current.add(o.id);
        const mint = o.mint ?? o.tokenAddress ?? null;
        if (!mint) continue;

        // Fire-and-forget, just like the DexScreener stream path.
        const controller = new AbortController();
        controllers.add(controller);
        const to = setTimeout(() => controller.abort(), SAFETY_CHECK_TIMEOUT_MS);
        fetchSafetyVerdict(mint, controller.signal)
          .then((v) => {
            applySafetyVerdict({ opportunityId: o.id, score: v.score, verdict: v.verdict });
          })
          .catch((e) => {
            logStructured(e, {
              category: "stream",
              severity: "info",
              silent: true,
              userMessage: `Safety check failed for ${o.token}`,
              context: { mint },
            });
          })
          .finally(() => {
            clearTimeout(to);
            controllers.delete(controller);
          });
      }
    });

    return () => {
      unsub();
      // Abort any in-flight safety checks when the hook unmounts/disables.
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, [enabled, applySafetyVerdict, logAudit]);

  // Clean up the checked set when the bot stops so a restart re-checks.
  const status = useBotStore((s) => s.status);
  useEffect(() => {
    if (status === "idle") {
      checkedRef.current.clear();
    }
  }, [status]);
}
