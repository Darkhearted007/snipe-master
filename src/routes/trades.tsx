import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PositionsCard } from "@/components/positions-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useBotStore } from "@/lib/bot-store";
import { cn } from "@/lib/utils";
import type { BotMode } from "@/lib/bot-types";

export const Route = createFileRoute("/trades")({
  head: () => ({ meta: [{ title: "Trades — SniperBot" }] }),
  component: TradesPage,
});

function TradesPage() {
  const history = useBotStore((s) => s.tradeHistory);
  const totalFees = useBotStore((s) => s.totalFeesPaidSol);
  const clearHistory = useBotStore((s) => s.clearHistory);
  const [filter, setFilter] = useState<BotMode | "all">("all");

  const rows = filter === "all" ? history : history.filter((t) => t.mode === filter);
  const paperCount = history.filter((t) => t.mode === "paper").length;
  const liveCount = history.filter((t) => t.mode === "live").length;

  const totalPnl = rows.reduce((a, t) => a + t.pnlSol, 0);
  const totalNet = rows.reduce((a, t) => a + t.netToUserSol, 0);

  return (
    <div className="grid gap-4">
      <PositionsCard />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium">
            <span>Trade history</span>
            <div className="flex items-center gap-2">
              <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                <TabsList>
                  <TabsTrigger value="all">
                    All <span className="ml-1 text-muted-foreground">{history.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="paper">
                    Paper <span className="ml-1 text-muted-foreground">{paperCount}</span>
                  </TabsTrigger>
                  <TabsTrigger value="live">
                    Live <span className="ml-1 text-muted-foreground">{liveCount}</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                size="sm"
                variant="ghost"
                disabled={history.length === 0}
                onClick={() => {
                  clearHistory();
                  toast("Trade history cleared");
                }}
              >
                Clear
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-6 border-b px-4 py-3 text-xs">
            <Kv
              label="Total P&L"
              value={fmtSol(totalPnl)}
              tone={totalPnl >= 0 ? "success" : "danger"}
            />
            <Kv
              label="Net to wallet"
              value={fmtSol(totalNet)}
              tone={totalNet >= 0 ? "success" : "danger"}
            />
            <Kv label="Fees routed" value={totalFees.toFixed(5) + " SOL"} tone="muted" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Net → wallet</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-xs text-muted-foreground"
                  >
                    No trades yet
                  </TableCell>
                </TableRow>
              )}
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {new Date(t.ts).toLocaleTimeString([], { hour12: false })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={t.mode === "live" ? "default" : "secondary"}
                      className={cn(
                        "text-[10px]",
                        t.mode === "live" && "bg-live text-live-foreground",
                      )}
                    >
                      {t.mode.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{t.token}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {t.venue}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[10px] uppercase text-muted-foreground">
                    {t.reason}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {t.sizeSol.toFixed(5)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs",
                      t.pnlSol >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {fmtSol(t.pnlSol)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {t.feePaidSol > 0 ? t.feePaidSol.toFixed(5) : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs",
                      t.netToUserSol >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {fmtSol(t.netToUserSol)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function fmtSol(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(5)}`;
}

function Kv({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "muted";
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
