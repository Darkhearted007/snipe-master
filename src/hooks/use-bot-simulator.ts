import { useEffect } from "react";
import { useBotStore } from "@/lib/bot-store";

/**
 * Drives the simulator tick + resilient watchdog.
 *
 * Design contract (Phase 1 resilience):
 * - Bot ticks whenever `status !== "idle"`. The ONLY thing that transitions
 *   the bot to `idle` is the Stop button (or Kill switch).
 * - Transient tick failures NEVER change status. They're logged and the loop
 *   keeps running so the next tick can retry.
 * - Network offline events are logged as audit entries but do not halt the bot.
 * - When the tab comes back online, we ping healthCheck immediately.
 */
export function useBotSimulator() {
  const status = useBotStore((s) => s.status);
  const tick = useBotStore((s) => s.tick);
  const healthCheck = useBotStore((s) => s.healthCheck);
  const logAudit = useBotStore((s) => s.logAudit);

  useEffect(() => {
    if (status === "idle") return;
    let cancelled = false;
    const iv = window.setInterval(() => {
      if (cancelled) return;
      try {
        tick();
      } catch (err) {
        // Never propagate — resilience rule: keep looping.
        // eslint-disable-next-line no-console
        console.error("[simulator] tick threw", err);
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [status, tick]);

  useEffect(() => {
    const iv = window.setInterval(() => {
      try {
        healthCheck();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[simulator] health check failed", err);
      }
    }, 5000);
    return () => window.clearInterval(iv);
  }, [healthCheck]);

  useEffect(() => {
    const onOffline = () =>
      logAudit(
        "Network offline · bot continues on cached state; new feed suspended",
        "error",
      );
    const onOnline = () => {
      logAudit("Network restored · resuming feed", "audit");
      try {
        healthCheck();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [logAudit, healthCheck]);
}
