import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBotStore } from "@/lib/bot-store";

export function EquityCard() {
  const { equity, startBankroll, bankroll, peakBankroll } = useBotStore();
  const current = equity[equity.length - 1]?.value ?? bankroll;
  const drawdown = ((peakBankroll - current) / peakBankroll) * 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>Equity Curve</span>
          <span className="font-mono text-xs text-muted-foreground">
            start {startBankroll.toFixed(3)} SOL
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equity}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={() => ""}
                formatter={(v: number) => [`${v.toFixed(5)} SOL`, "equity"]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-primary)"
                strokeWidth={1.5}
                fill="url(#eq)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <Stat label="Current" value={`${current.toFixed(5)}`} />
          <Stat label="Peak" value={`${peakBankroll.toFixed(5)}`} />
          <Stat
            label="Drawdown"
            value={`${drawdown.toFixed(2)}%`}
            tone={drawdown > 10 ? "danger" : drawdown > 5 ? "warning" : "neutral"}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  const color =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-muted/30 px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`font-mono text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}
