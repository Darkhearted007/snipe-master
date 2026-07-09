import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { AlertTriangle, Sparkles, Wallet } from "lucide-react";
import { useBotStore } from "@/lib/bot-store";
import { MIN_USER_DEPOSIT_SOL, PLATFORM_FEE_WALLET } from "@/lib/bot-types";
import { RiskSettingsCard } from "@/components/risk-settings-card";
import type { Venue } from "@/lib/bot-types";
import { useState } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — SniperBot" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const guardrails = useBotStore((s) => s.guardrails);
  const setGuardrails = useBotStore((s) => s.setGuardrails);
  const activeVenues = useBotStore((s) => s.activeVenues);
  const toggleVenue = useBotStore((s) => s.toggleVenue);
  const userDeposit = useBotStore((s) => s.userDeposit);
  const setUserDeposit = useBotStore((s) => s.setUserDeposit);
  const platformFeePct = useBotStore((s) => s.platformFeePct);
  const setPlatformFeePct = useBotStore((s) => s.setPlatformFeePct);
  const totalFeesPaidSol = useBotStore((s) => s.totalFeesPaidSol);
  const bankroll = useBotStore((s) => s.bankroll);
  const clearLogs = useBotStore((s) => s.clearLogs);

  const [depositInput, setDepositInput] = useState(userDeposit.toString());

  const applyDeposit = () => {
    const v = Number(depositInput);
    const res = setUserDeposit(v);
    if (!res.ok) {
      toast.error("Invalid deposit", { description: res.error });
      setDepositInput(userDeposit.toString());
      return;
    }
    toast.success(`Session bankroll set to ${v} SOL`);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <Wallet className="h-4 w-4 text-live" /> Session bankroll
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Deposit amount (SOL)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                step={0.05}
                min={MIN_USER_DEPOSIT_SOL}
                value={depositInput}
                onChange={(e) => setDepositInput(e.target.value)}
                className="font-mono"
              />
              <Button onClick={applyDeposit}>Apply</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Minimum {MIN_USER_DEPOSIT_SOL} SOL. Applying resets session P&L.
              Current bankroll:{" "}
              <span className="font-mono text-foreground">{bankroll.toFixed(5)} SOL</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-warning" /> Platform fee
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Fee on profits</span>
              <span className="font-mono">{platformFeePct}%</span>
            </div>
            <Slider
              value={[platformFeePct]}
              min={0}
              max={30}
              step={1}
              onValueChange={(v) => setPlatformFeePct(v[0])}
            />
          </div>
          <div className="rounded-md border bg-muted/30 p-2 text-[10px]">
            <div className="uppercase tracking-wider text-muted-foreground">
              Treasury wallet
            </div>
            <div className="mt-0.5 break-all font-mono">{PLATFORM_FEE_WALLET}</div>
          </div>
          <p className="text-xs text-muted-foreground">
            Fees apply to live-mode profitable exits only. Losses are not taxed.
            Total routed this device:{" "}
            <span className="font-mono text-foreground">
              {totalFeesPaidSol.toFixed(5)} SOL
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <RiskSettingsCard />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Venues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["raydium", "pumpfun", "bsc"] as Venue[]).map((v) => (
            <div key={v} className="flex items-center justify-between">
              <div>
                <Label className="capitalize">{v}</Label>
                <p className="text-xs text-muted-foreground">
                  {v === "bsc" ? "PancakeSwap-compatible" : "Solana"}
                </p>
              </div>
              <Switch checked={activeVenues[v]} onCheckedChange={() => toggleVenue(v)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" /> Data & memory
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            State (watchlist, trade history, audit log, guardrails, wallet) is
            persisted to <span className="font-mono">localStorage</span> under
            key <span className="font-mono">sniperbot-state-v2</span>. Clearing
            it below cannot be undone.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearLogs();
              toast("Decision & audit log cleared");
            }}
          >
            Clear log
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  step,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className={disabled ? "text-muted-foreground" : ""}>{label}</Label>
      <Input
        type="number"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="font-mono"
      />
    </div>
  );
}
