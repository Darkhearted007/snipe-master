import { useEffect, useState } from "react";
import { useBotStore } from "@/lib/bot-store";
import { StatusDot } from "./status-dot";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WalletReadinessBadge } from "./wallet-readiness-badge";

function useUptime(startedAt: number | null, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [running]);
  if (!startedAt || !running) return "00:00:00";
  const s = Math.floor((now - startedAt) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

export function StatusStrip() {
  const {
    status,
    mode,
    startedAt,
    bankroll,
    sessionPnl,
    positions,
    tradesToday,
    skipsToday,
    activeVenues,
  } = useBotStore();
  const uptime = useUptime(startedAt, status === "running");

  const kpis = [
    { label: "Bankroll", value: `${bankroll.toFixed(5)} SOL` },
    {
      label: "Session P&L",
      value: `${sessionPnl >= 0 ? "+" : ""}${sessionPnl.toFixed(5)} SOL`,
      tone: sessionPnl >= 0 ? "success" : "danger",
    },
    { label: "Open", value: positions.length.toString() },
    { label: "Trades", value: tradesToday.toString() },
    { label: "Skips", value: skipsToday.toString() },
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-4 border-b bg-card/40 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <StatusDot status={status} size="md" />
        <span className="font-mono text-xs uppercase tracking-widest">{status}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>uptime</span>
        <span className="font-mono text-foreground">{uptime}</span>
      </div>
      <Badge
        variant={mode === "live" ? "default" : "secondary"}
        className={cn(mode === "live" && "bg-live text-live-foreground")}
      >
        {mode === "live" ? "LIVE" : "PAPER"}
      </Badge>
      <div className="flex items-center gap-1">
        {(Object.keys(activeVenues) as Array<keyof typeof activeVenues>).map((v) => (
          <Badge
            key={v}
            variant="outline"
            className={cn("text-[10px] uppercase", !activeVenues[v] && "opacity-40 line-through")}
          >
            {v}
          </Badge>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {k.label}
            </span>
            <span
              className={cn(
                "font-mono text-sm font-semibold tabular-nums",
                "tone" in k && k.tone === "success" && "text-success",
                "tone" in k && k.tone === "danger" && "text-danger",
              )}
            >
              {k.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
