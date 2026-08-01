import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck, Sparkles } from "lucide-react";
import { useBotStore } from "@/lib/bot-store";
import { cn } from "@/lib/utils";

export function GuardrailsCard() {
  const {
    guardrails,
    positions,
    bankroll,
    startBankroll,
    peakBankroll,
    guardrailBreached,
    acknowledgeBreach,
  } = useBotStore();

  const largest = positions.reduce((m, p) => Math.max(m, p.sizeSol), 0);
  // Compute equity the same way applyTick() does: bankroll + the value of
  // all open positions. Using raw `bankroll` alone produces a false drawdown
  // spike the moment a live position opens (SOL leaves the wallet but is
  // still held as tokens), which doesn't match the actual guardrail check
  // and confuses users into thinking the drawdown limit is breached.
  const openPositionsValue = positions.reduce((a, p) => a + p.sizeSol, 0);
  const equity = bankroll + openPositionsValue;
  const dailyLoss = Math.max(0, ((startBankroll - equity) / startBankroll) * 100);
  const drawdown = Math.max(0, ((peakBankroll - equity) / peakBankroll) * 100);

  const adaptive = guardrails.adaptiveSizing;

  const rails = [
    adaptive
      ? {
          label: "Position size (agent)",
          current: largest.toFixed(5) + " SOL",
          pct: Math.min(100, (largest / Math.max(bankroll, 0.001)) * 100),
          cap: "adaptive",
        }
      : {
          label: "Max position size",
          current: largest.toFixed(5) + " SOL",
          pct: (largest / guardrails.maxPositionSol) * 100,
          cap: `${guardrails.maxPositionSol} SOL`,
        },
    {
      label: "Daily loss",
      current: dailyLoss.toFixed(2) + "%",
      pct: (dailyLoss / guardrails.dailyLossLimitPct) * 100,
      cap: `${guardrails.dailyLossLimitPct}%`,
    },
    {
      label: "Drawdown",
      current: drawdown.toFixed(2) + "%",
      pct: (drawdown / guardrails.drawdownLimitPct) * 100,
      cap: `${guardrails.drawdownLimitPct}%`,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-live" /> Guardrails
            {adaptive && (
              <Badge className="ml-1 gap-1 bg-live text-live-foreground text-[10px]">
                <Sparkles className="h-3 w-3" /> adaptive
              </Badge>
            )}
          </span>
          {guardrailBreached && (
            <Button size="sm" variant="outline" onClick={acknowledgeBreach}>
              Acknowledge
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rails.map((r) => {
          const clamped = Math.min(100, r.pct);
          const tone = r.pct >= 100 ? "danger" : r.pct >= 75 ? "warning" : "success";
          return (
            <div key={r.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-mono">
                  {r.current} <span className="text-muted-foreground">/ {r.cap}</span>
                </span>
              </div>
              <Progress
                value={clamped}
                className={cn(
                  "h-1.5",
                  tone === "danger" && "[&>div]:bg-danger",
                  tone === "warning" && "[&>div]:bg-warning",
                  tone === "success" && "[&>div]:bg-success",
                )}
              />
            </div>
          );
        })}
        <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <AlertTriangle
            className={cn("h-3 w-3", guardrailBreached ? "text-danger" : "text-live")}
          />
          Duplicate-position guard {guardrails.duplicateGuard ? "on" : "off"}
        </div>
      </CardContent>
    </Card>
  );
}
