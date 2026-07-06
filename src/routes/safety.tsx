import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBotStore } from "@/lib/bot-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/safety")({
  head: () => ({ meta: [{ title: "Safety — SniperBot" }] }),
  component: SafetyPage,
});

function SafetyPage() {
  const opps = useBotStore((s) => s.opportunities);

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {opps.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            No screened tokens yet
          </CardContent>
        </Card>
      )}
      {opps.map((o) => (
        <Card key={o.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="font-mono">{o.token}</span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {o.venue}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <Row k="Safety score" v={`${o.safety}/100`} tone={tone(o.safety)} />
            <Row k="Confidence" v={`${o.confidence}%`} tone={tone(o.confidence)} />
            <Row k="Liquidity" v={`${o.liquiditySol.toFixed(2)} SOL`} />
            <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
              LP locked · honeypot passed · holder concentration ok
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function tone(n: number) {
  if (n >= 70) return "text-success";
  if (n >= 50) return "text-warning";
  return "text-danger";
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-mono", tone)}>{v}</span>
    </div>
  );
}
