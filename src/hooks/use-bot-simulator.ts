import { useEffect } from "react";
import { useBotStore } from "@/lib/bot-store";

export function useBotSimulator() {
  const status = useBotStore((s) => s.status);
  const tick = useBotStore((s) => s.tick);

  useEffect(() => {
    if (status !== "running") return;
    const iv = window.setInterval(() => tick(), 1500);
    return () => window.clearInterval(iv);
  }, [status, tick]);
}
