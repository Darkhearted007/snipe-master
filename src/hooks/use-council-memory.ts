/**
 * Council memory sync:
 * - On session ready, load recent memory rows from the server and hydrate the store.
 * - Register an append handler so new debriefs are mirrored server-side.
 *
 * Best-effort — failures never break the bot loop.
 */
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useBotStore } from "@/lib/bot-store";
import { appendCouncilMemory, loadCouncilMemory } from "@/lib/council.functions";
import type { CouncilMemoryEntry } from "@/lib/council";
import { useAuthSession } from "./use-auth-session";

export function useCouncilMemory() {
  const session = useAuthSession();
  const load = useServerFn(loadCouncilMemory);
  const append = useServerFn(appendCouncilMemory);
  const setCouncilMemory = useBotStore((s) => s.setCouncilMemory);
  const setHandler = useBotStore((s) => s.setCouncilAppendHandler);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await load({ data: { limit: 60 } });
        if (cancelled || !res.ok) return;
        const entries: CouncilMemoryEntry[] = res.entries.map((r) => {
          let insights: CouncilMemoryEntry["insights"] = {};
          try {
            insights = JSON.parse(r.insights_json) as CouncilMemoryEntry["insights"];
          } catch {
            /* ignore malformed rows */
          }
          return {
            id: r.id,
            ts: new Date(r.created_at).getTime() || Date.now(),
            cycleId: r.cycle_id,
            agent: r.agent,
            summary: r.summary,
            insights,
            pnlDeltaSol: r.pnl_delta_sol,
            tradesInWindow: r.trades_in_window,
          };
        });
        setCouncilMemory(entries);
      } catch (e) {
        console.warn("[council] load failed", e);
      }
    })();

    const handler = (entry: CouncilMemoryEntry) => {
      append({
        data: {
          cycle_id: entry.cycleId,
          agent: entry.agent,
          summary: entry.summary,
          insights_json: JSON.stringify(entry.insights ?? {}),
          pnl_delta_sol: entry.pnlDeltaSol,
          trades_in_window: entry.tradesInWindow,
        },
      }).catch((e) => console.warn("[council] append failed", e));
    };
    setHandler(handler);

    return () => {
      cancelled = true;
      setHandler(undefined);
    };
  }, [session, load, append, setCouncilMemory, setHandler]);
}
