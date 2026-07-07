import { useEffect } from "react";
import { useBotStore } from "@/lib/bot-store";

/**
 * Drives the simulator tick and a lightweight self-healing watchdog.
 * - Ticks every 1.5s while status === "running"
 * - Health check every 5s regardless — auto-recovers from "error" state
 */
export function useBotSimulator() {
  const status = useBotStore((s) => s.status);
  const tick = useBotStore((s) => s.tick);
  const healthCheck = useBotStore((s) => s.healthCheck);

  useEffect(() => {
    if (status !== "running") return;
    const iv = window.setInterval(() => {
      try {
        tick();
      } catch (err) {
        // tick() already handles internally, but guard the interval too.
        console.error("[simulator] tick threw", err);
      }
    }, 1500);
    return () => window.clearInterval(iv);
  }, [status, tick]);

  useEffect(() => {
    const iv = window.setInterval(() => {
      try {
        healthCheck();
      } catch (err) {
        console.error("[simulator] health check failed", err);
      }
    }, 5000);
    return () => window.clearInterval(iv);
  }, [healthCheck]);
}
