import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Info,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useBotStore } from "@/lib/bot-store";
import { useTokenSafety, isSafetyVerdict } from "@/hooks/use-token-safety";
import type { SafetyVerdict } from "@/routes/api/rugcheck.$mint";
import { cn } from "@/lib/utils";

// Known-safe examples users can click to sanity-check the pipeline.
const EXAMPLES: Array<{ label: string; mint: string }> = [
  { label: "SOL (wrapped)", mint: "So11111111111111111111111111111111111111112" },
  { label: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { label: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
];

export const Route = createFileRoute("/safety")({
  head: () => ({
    meta: [
      { title: "Safety — SniperBot" },
      {
        name: "description",
        content:
          "Real-time Solana token safety checks via rugcheck.xyz — mint authority, freeze authority, LP lock, and holder concentration.",
      },
    ],
  }),
  component: SafetyPage,
});

function SafetyPage() {
  const [input, setInput] = useState("");
  const [mint, setMint] = useState<string | null>(null);
  const watchlist = useBotStore((s) => s.watchlist);
  const safety = useTokenSafety(mint);

  const submit = (val: string) => {
    const trimmed = val.trim();
    if (trimmed.length < 32) return;
    setInput(trimmed);
    setMint(trimmed);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Screen a Solana token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <Input
              placeholder="Paste mint address (base58)…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" size="sm" className="gap-1.5">
              <Search className="h-4 w-4" /> Check
            </Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => (
              <Button
                key={e.mint}
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => submit(e.mint)}
              >
                {e.label}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Live data via rugcheck.xyz — mint/freeze authority, LP lock, top
            holder concentration, and risk flags.
          </p>
        </CardContent>
      </Card>

      {mint && <SafetyResult query={safety} mint={mint} />}

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Watchlist safety
        </h2>
        {watchlist.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-xs text-muted-foreground">
              No watchlist entries yet
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {watchlist.slice(0, 12).map((w) => (
              <WatchlistSafetyCard
                key={w.id}
                symbol={w.symbol}
                venue={w.venue}
                mint={w.mintAddress ?? null}
                onInspect={(m) => {
                  setInput(m);
                  setMint(m);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WatchlistSafetyCard({
  symbol,
  venue,
  mint,
  onInspect,
}: {
  symbol: string;
  venue: string;
  mint: string | null;
  onInspect: (mint: string) => void;
}) {
  const q = useTokenSafety(mint);
  const verdict = isSafetyVerdict(q.data) ? q.data : null;

  return (
    <Card className={cn(!mint && "opacity-80")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="font-mono">{symbol}</span>
          <div className="flex items-center gap-1.5">
            {!mint && (
              <Badge
                variant="secondary"
                className="text-[9px] uppercase text-muted-foreground"
              >
                rugcheck disabled
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] uppercase">
              {venue}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {!mint ? (
          <div className="rounded-md border border-dashed border-warning/40 bg-warning/5 px-3 py-4 text-center">
            <Info className="mx-auto mb-1.5 h-4 w-4 text-warning" />
            <div className="text-[11px] font-medium text-warning">
              Mint address required
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add a Solana mint to this watchlist entry to enable Rugcheck safety
              screening.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 gap-1 text-[11px]"
              asChild
            >
              <Link to="/watchlist">
                <Plus className="h-3 w-3" /> Add mint
              </Link>
            </Button>
          </div>
        ) : q.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Fetching rugcheck…
          </div>
        ) : q.isError ? (
          <div className="text-danger">Fetch failed</div>
        ) : verdict ? (
          <>
            <Row
              k="Rugcheck score"
              v={verdict.score == null ? "—" : `${verdict.score}/100`}
              tone={verdict.score == null ? undefined : tone(verdict.score)}
            />
            <Row
              k="Verdict"
              v={verdict.verdict}
              tone={
                verdict.verdict === "safe"
                  ? "text-success"
                  : verdict.verdict === "danger"
                    ? "text-danger"
                    : "text-warning"
              }
            />
            <Row
              k="Risk flags"
              v={verdict.risks.length.toString()}
              tone={
                verdict.risks.length === 0
                  ? "text-success"
                  : verdict.risks.length > 3
                    ? "text-danger"
                    : "text-warning"
              }
            />
          </>
        ) : (
          <div className="rounded-md border border-dashed bg-muted/20 px-2 py-3 text-center text-[11px] text-muted-foreground">
            Rugcheck has no report for this mint
          </div>
        )}
        {mint && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-7 text-[11px]"
            onClick={() => onInspect(mint)}
          >
            Inspect
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SafetyResult({
  query,
  mint,
}: {
  query: ReturnType<typeof useTokenSafety>;
  mint: string;
}) {
  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Fetching on-chain safety
          data…
        </CardContent>
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Safety check failed</AlertTitle>
        <AlertDescription className="text-xs">
          {(query.error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }
  const data = query.data;
  if (!data) return null;
  if (!isSafetyVerdict(data)) {
    return (
      <Alert>
        <ShieldQuestion className="h-4 w-4" />
        <AlertTitle>Verdict unavailable</AlertTitle>
        <AlertDescription className="text-xs">
          Rugcheck did not return a report for{" "}
          <span className="font-mono break-all">{mint}</span>. This may be an
          unindexed or invalid mint.
        </AlertDescription>
      </Alert>
    );
  }

  const v: SafetyVerdict = data;
  const verdictTone =
    v.verdict === "safe"
      ? "border-success/40 bg-success/5"
      : v.verdict === "danger"
        ? "border-danger/40 bg-danger/5"
        : v.verdict === "caution"
          ? "border-warning/40 bg-warning/5"
          : "";
  const VerdictIcon =
    v.verdict === "safe"
      ? ShieldCheck
      : v.verdict === "danger"
        ? ShieldAlert
        : ShieldQuestion;

  return (
    <Card className={cn(verdictTone)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <VerdictIcon
              className={cn(
                "h-4 w-4",
                v.verdict === "safe"
                  ? "text-success"
                  : v.verdict === "danger"
                    ? "text-danger"
                    : "text-warning",
              )}
            />
            <span className="font-mono">
              {v.symbol ?? "Unknown"}
              {v.name ? ` · ${v.name}` : ""}
            </span>
          </span>
          <Badge
            variant={
              v.verdict === "danger"
                ? "destructive"
                : v.verdict === "safe"
                  ? "default"
                  : "secondary"
            }
            className="uppercase text-[10px]"
          >
            {v.verdict}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <Row
            k="Safety score"
            v={v.score == null ? "—" : `${v.score}/100`}
            tone={v.score == null ? undefined : tone(v.score)}
          />
          <Row
            k="Mint authority"
            v={v.flags.mintAuthorityRevoked ? "revoked ✓" : "active ⚠"}
            tone={v.flags.mintAuthorityRevoked ? "text-success" : "text-danger"}
          />
          <Row
            k="Freeze authority"
            v={v.flags.freezeAuthorityRevoked ? "revoked ✓" : "active ⚠"}
            tone={v.flags.freezeAuthorityRevoked ? "text-success" : "text-danger"}
          />
          <Row
            k="LP locked"
            v={
              v.flags.lpLocked == null
                ? "unknown"
                : v.flags.lpLocked
                  ? `yes${v.flags.lpLockedPct ? ` (${v.flags.lpLockedPct.toFixed(0)}%)` : ""}`
                  : "no"
            }
            tone={
              v.flags.lpLocked == null
                ? undefined
                : v.flags.lpLocked
                  ? "text-success"
                  : "text-danger"
            }
          />
          <Row
            k="Top holder"
            v={
              v.flags.topHolderPct == null
                ? "—"
                : `${v.flags.topHolderPct.toFixed(1)}%`
            }
            tone={
              v.flags.topHolderPct == null
                ? undefined
                : v.flags.topHolderPct > 20
                  ? "text-danger"
                  : v.flags.topHolderPct > 10
                    ? "text-warning"
                    : "text-success"
            }
          />
          <Row
            k="Insider hold"
            v={
              v.flags.insiderPct == null
                ? "—"
                : `${v.flags.insiderPct.toFixed(1)}%`
            }
            tone={
              v.flags.insiderPct == null
                ? undefined
                : v.flags.insiderPct > 5
                  ? "text-danger"
                  : "text-success"
            }
          />
        </div>

        {v.risks.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Risk flags
            </div>
            <ul className="space-y-1">
              {v.risks.slice(0, 8).map((r, i) => (
                <li
                  key={i}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-[11px]",
                    r.level === "danger" || r.level === "high"
                      ? "border-danger/40 bg-danger/5"
                      : r.level === "warn" || r.level === "medium"
                        ? "border-warning/40 bg-warning/5"
                        : "border-muted bg-muted/30",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {r.level}
                    </Badge>
                  </div>
                  {r.description && (
                    <div className="mt-0.5 text-muted-foreground">
                      {r.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="pt-1 font-mono text-[10px] text-muted-foreground break-all">
          {v.mint}
        </p>
      </CardContent>
    </Card>
  );
}

function tone(n: number) {
  if (n >= 70) return "text-success";
  if (n >= 50) return "text-warning";
  return "text-danger";
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between rounded-md border bg-muted/20 px-2 py-1.5">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-mono", tone)}>{v}</span>
    </div>
  );
}
