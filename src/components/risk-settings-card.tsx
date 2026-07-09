import { AlertTriangle, ShieldCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useBotStore } from "@/lib/bot-store";
import { cn } from "@/lib/utils";

export function RiskSettingsCard({ compact = false }: { compact?: boolean }) {
  const guardrails = useBotStore((s) => s.guardrails);
  const setGuardrails = useBotStore((s) => s.setGuardrails);
  const bankroll = useBotStore((s) => s.bankroll);
  const startBankroll = useBotStore((s) => s.startBankroll);
  const peakBankroll = useBotStore((s) => s.peakBankroll);
  const positions = useBotStore((s) => s.positions);
  const breached = useBotStore((s) => s.guardrailBreached);
  const acknowledgeBreach = useBotStore((s) => s.acknowledgeBreach);

  const largest = positions.reduce((m, p) => Math.max(m, p.sizeSol), 0);
  const dailyLossPct = Math.max(
    0,
    ((startBankroll - bankroll) / Math.max(startBankroll, 1e-9)) * 100,
  );
  const drawdownPct = Math.max(
    0,
    ((peakBankroll - bankroll) / Math.max(peakBankroll, 1e-9)) * 100,
  );

  const adaptive = guardrails.adaptiveSizing;
  const sizeUsedPct = adaptive
    ? 0
    : Math.min(100, (largest / Math.max(guardrails.maxPositionSol, 1e-9)) * 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-live" /> Risk settings
          </CardTitle>
          {breached && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> breached
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-5", compact && "space-y-4")}>
        {/* Position sizing */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="adaptive-size" className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-warning" />
              Agent-decided position size
              {adaptive && (
                <Badge className="bg-live text-live-foreground text-[10px]">
                  adaptive
                </Badge>
              )}
            </Label>
            <Switch
              id="adaptive-size"
              checked={adaptive}
              onCheckedChange={(v) => setGuardrails({ adaptiveSizing: v })}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            When on, agent sizes 5–40% of bankroll from confidence × safety and
            ignores the manual cap below.
          </p>

          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <div>
              <Label
                htmlFor="max-pos"
                className={cn("text-xs", adaptive && "text-muted-foreground")}
              >
                Max position size (SOL)
              </Label>
              <Slider
                value={[guardrails.maxPositionSol]}
                min={0.005}
                max={Math.max(0.5, bankroll * 0.9)}
                step={0.005}
                disabled={adaptive}
                onValueChange={(v) => setGuardrails({ maxPositionSol: v[0] })}
                className="mt-1.5"
              />
            </div>
            <Input
              id="max-pos"
              type="number"
              step={0.005}
              min={0.005}
              value={guardrails.maxPositionSol}
              disabled={adaptive}
              onChange={(e) =>
                setGuardrails({ maxPositionSol: Number(e.target.value) || 0 })
              }
              className="w-24 font-mono text-xs"
            />
          </div>
          {!adaptive && (
            <div className="space-y-0.5">
              <Progress value={sizeUsedPct} className="h-1" />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>
                  Largest open:{" "}
                  <span className="font-mono">{largest.toFixed(4)} SOL</span>
                </span>
                <span className="font-mono">{sizeUsedPct.toFixed(0)}% of cap</span>
              </div>
            </div>
          )}
        </section>

        {/* Daily loss failsafe */}
        <section className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Daily-loss fail-safe</Label>
            <span className="font-mono text-xs">
              {guardrails.dailyLossLimitPct}%
            </span>
          </div>
          <Slider
            value={[guardrails.dailyLossLimitPct]}
            min={1}
            max={50}
            step={1}
            onValueChange={(v) => setGuardrails({ dailyLossLimitPct: v[0] })}
          />
          <div className="space-y-0.5">
            <Progress
              value={Math.min(
                100,
                (dailyLossPct / Math.max(guardrails.dailyLossLimitPct, 1)) * 100,
              )}
              className={cn(
                "h-1",
                dailyLossPct >= guardrails.dailyLossLimitPct &&
                  "[&>div]:bg-destructive",
              )}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>
                Today:{" "}
                <span
                  className={cn(
                    "font-mono",
                    dailyLossPct >= guardrails.dailyLossLimitPct &&
                      "text-destructive",
                  )}
                >
                  −{dailyLossPct.toFixed(2)}%
                </span>
              </span>
              <span>Bot auto-halts at the limit.</span>
            </div>
          </div>
        </section>

        {/* Drawdown */}
        <section className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Drawdown limit (from peak)</Label>
            <span className="font-mono text-xs">
              {guardrails.drawdownLimitPct}%
            </span>
          </div>
          <Slider
            value={[guardrails.drawdownLimitPct]}
            min={1}
            max={50}
            step={1}
            onValueChange={(v) => setGuardrails({ drawdownLimitPct: v[0] })}
          />
          <div className="space-y-0.5">
            <Progress
              value={Math.min(
                100,
                (drawdownPct / Math.max(guardrails.drawdownLimitPct, 1)) * 100,
              )}
              className={cn(
                "h-1",
                drawdownPct >= guardrails.drawdownLimitPct &&
                  "[&>div]:bg-destructive",
              )}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>
                From peak:{" "}
                <span
                  className={cn(
                    "font-mono",
                    drawdownPct >= guardrails.drawdownLimitPct &&
                      "text-destructive",
                  )}
                >
                  −{drawdownPct.toFixed(2)}%
                </span>
              </span>
              <span>
                Peak: <span className="font-mono">{peakBankroll.toFixed(4)}</span>
              </span>
            </div>
          </div>
        </section>

        {/* Duplicate guard */}
        <section className="flex items-center justify-between border-t pt-4">
          <div>
            <Label htmlFor="dup-guard" className="text-xs">
              Duplicate-position guard
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Blocks a second entry into a token you already hold.
            </p>
          </div>
          <Switch
            id="dup-guard"
            checked={guardrails.duplicateGuard}
            onCheckedChange={(v) => setGuardrails({ duplicateGuard: v })}
          />
        </section>

        {breached && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-destructive">
                A guardrail breached — bot halted.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={acknowledgeBreach}
              >
                Acknowledge
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
