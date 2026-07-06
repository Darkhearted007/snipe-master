import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useBotStore } from "@/lib/bot-store";
import type { Venue } from "@/lib/bot-types";
import { useState } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — SniperBot" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { guardrails, setGuardrails, activeVenues, toggleVenue } = useBotStore();
  const [authMode, setAuthMode] = useState<"wallet" | "secret">("wallet");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Risk configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Max position size (SOL)"
            value={guardrails.maxPositionSol}
            step={0.005}
            onChange={(v) => setGuardrails({ maxPositionSol: v })}
          />
          <Field
            label="Daily loss limit (%)"
            value={guardrails.dailyLossLimitPct}
            step={1}
            onChange={(v) => setGuardrails({ dailyLossLimitPct: v })}
          />
          <Field
            label="Drawdown limit (%)"
            value={guardrails.drawdownLimitPct}
            step={1}
            onChange={(v) => setGuardrails({ drawdownLimitPct: v })}
          />
          <div className="flex items-center justify-between border-t pt-3">
            <Label htmlFor="dup">Duplicate-position guard</Label>
            <Switch
              id="dup"
              checked={guardrails.duplicateGuard}
              onCheckedChange={(v) => setGuardrails({ duplicateGuard: v })}
            />
          </div>
        </CardContent>
      </Card>

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

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Dashboard authentication (UI preview)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={authMode}
            onValueChange={(v) => setAuthMode(v as typeof authMode)}
            className="grid gap-3 md:grid-cols-2"
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent">
              <RadioGroupItem value="wallet" id="wallet" className="mt-1" />
              <div>
                <div className="text-sm font-medium">Solana wallet session</div>
                <div className="text-xs text-muted-foreground">
                  Sign message to authenticate. Recommended.
                </div>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent">
              <RadioGroupItem value="secret" id="secret" className="mt-1" />
              <div>
                <div className="text-sm font-medium">Secret key</div>
                <div className="text-xs text-muted-foreground">
                  Server-managed API secret. Headless deploys.
                </div>
              </div>
            </label>
          </RadioGroup>
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
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="font-mono"
      />
    </div>
  );
}
