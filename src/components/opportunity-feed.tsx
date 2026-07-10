import { useState } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useBotStore } from "@/lib/bot-store";
import type { Opportunity } from "@/lib/bot-types";
import { cn } from "@/lib/utils";
import { useLiveExecution } from "@/hooks/use-live-execution";
import { SOL_MINT } from "@/lib/jupiter";

const LAMPORTS_PER_SOL = 1_000_000_000;

function ExecuteButton({ opp }: { opp: Opportunity }) {
  const mode = useBotStore((s) => s.mode);
  const requestLiveEntry = useBotStore((s) => s.requestLiveEntry);
  const confirmLiveEntry = useBotStore((s) => s.confirmLiveEntry);
  const failLiveEntry = useBotStore((s) => s.failLiveEntry);
  const { executeSwap, walletReady } = useLiveExecution();
  const [busy, setBusy] = useState(false);

  if (mode !== "live" || !opp.mint) return null;

  const gate = requestLiveEntry(opp.id);

  return (
    <Button
      size="sm"
      variant={gate.ok ? "default" : "secondary"}
      disabled={!gate.ok || !walletReady || busy}
      title={gate.ok ? undefined : gate.error}
      onClick={async (e) => {
        e.stopPropagation();
        if (!gate.ok) return;
        setBusy(true);
        try {
          const result = await executeSwap({
            inputMint: SOL_MINT,
            outputMint: opp.mint!,
            amountLamports: Math.floor(gate.sizeSol * LAMPORTS_PER_SOL),
            slippageBps: 300,
            maxPriceImpactPct: 15,
          });
          confirmLiveEntry({
            opportunityId: opp.id,
            sizeSol: gate.sizeSol,
            signature: result.signature,
          });
        } catch (err) {
          failLiveEntry({
            opportunityId: opp.id,
            reason: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Executing…" : "Execute"}
    </Button>
  );
}

export function OpportunityFeed() {
  const opps = useBotStore((s) => s.opportunities);
  const [selected, setSelected] = useState<Opportunity | null>(null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Opportunity Feed
          <span className="ml-2 font-mono text-xs text-muted-foreground">{opps.length} pairs</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-[80px]">Time</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead className="text-right">Liquidity</TableHead>
                <TableHead className="text-right">Safety</TableHead>
                <TableHead className="text-right">Conf</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opps.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-xs text-muted-foreground"
                  >
                    No opportunities yet · start the bot
                  </TableCell>
                </TableRow>
              )}
              {opps.map((o) => (
                <TableRow
                  key={o.id}
                  onClick={() => setSelected(o)}
                  className="cursor-pointer animate-in fade-in slide-in-from-top-1 duration-300"
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(o.ts).toLocaleTimeString([], { hour12: false })}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{o.token}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {o.venue}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {o.liquiditySol.toFixed(1)}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono text-xs", scoreTone(o.safety))}>
                    {o.safety}
                  </TableCell>
                  <TableCell
                    className={cn("text-right font-mono text-xs", scoreTone(o.confidence))}
                  >
                    {o.confidence}
                  </TableCell>
                  <TableCell>
                    {o.decision === "enter" ? (
                      <Badge className="bg-success text-success-foreground">ENTER</Badge>
                    ) : (
                      <Badge variant="secondary" title={o.reason}>
                        SKIP
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <ExecuteButton opp={o} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-96 sm:max-w-96">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{selected.token}</SheetTitle>
                <SheetDescription>
                  {selected.venue.toUpperCase()} · {new Date(selected.ts).toLocaleString()}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4 px-4 text-sm">
                <Row k="Liquidity" v={`${selected.liquiditySol.toFixed(2)} SOL`} />
                <Row k="Safety score" v={`${selected.safety} / 100`} />
                <Row k="Confidence" v={`${selected.confidence}%`} />
                <Row
                  k="Decision"
                  v={selected.decision.toUpperCase()}
                  tone={selected.decision === "enter" ? "success" : "muted"}
                />
                {selected.reason && <Row k="Reason" v={selected.reason} />}
                <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="mb-1 font-semibold text-foreground">Safety checks</div>
                  {selected.mint ? (
                    <p>
                      {selected.safety === -1
                        ? "Not yet checked — no safety pipeline has scored this mint. Treated as unsafe until it is."
                        : `Safety score ${selected.safety}/100 from the last check.`}
                    </p>
                  ) : (
                    <p>Paper-mode simulated opportunity — not a real token.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function scoreTone(n: number) {
  if (n >= 70) return "text-success";
  if (n >= 50) return "text-warning";
  return "text-danger";
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "success" | "muted" }) {
  return (
    <div className="flex items-center justify-between border-b pb-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{k}</span>
      <span
        className={cn(
          "font-mono text-sm",
          tone === "success" && "text-success",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {v}
      </span>
    </div>
  );
}
