import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useBotStore } from "@/lib/bot-store";
import type { Venue, WatchSource } from "@/lib/bot-types";
import { cn } from "@/lib/utils";
import { isSafetyVerdict, useTokenSafety } from "@/hooks/use-token-safety";

export const Route = createFileRoute("/watchlist")({
  head: () => ({ meta: [{ title: "Watchlist — SniperBot" }] }),
  component: WatchlistPage,
});

const AUTO_PROMOTE_STREAK = 5;

function WatchlistPage() {
  const {
    watchlist,
    autoCurate,
    setAutoCurate,
    safetyFilters,
    setSafetyFilters,
    addWatch,
    removeWatch,
    toggleWatch,
    promoteAuto,
    clearAuto,
  } = useBotStore();

  const [symbol, setSymbol] = useState("");
  const [venue, setVenue] = useState<Venue>("raydium");
  const [note, setNote] = useState("");
  const [mintAddress, setMintAddress] = useState("");
  const [tab, setTab] = useState<WatchSource | "all">("all");

  const filtered = useMemo(
    () => (tab === "all" ? watchlist : watchlist.filter((w) => w.source === tab)),
    [watchlist, tab],
  );

  const manualCount = watchlist.filter((w) => w.source === "manual").length;
  const autoCount = watchlist.filter((w) => w.source === "auto").length;
  const enabledCount = watchlist.filter((w) => w.enabled).length;

  const handleAdd = () => {
    const mint = mintAddress.trim();
    if (mint && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      toast.error("Invalid mint address", {
        description: "Must be a base58 Solana mint (32–44 chars).",
      });
      return;
    }
    const res = addWatch({
      symbol,
      venue,
      note: note || undefined,
      mintAddress: mint || null,
    });
    if (!res.ok) {
      toast.error("Rejected by safety filter", { description: res.error });
      return;
    }
    toast.success(`${symbol.toUpperCase()} added`, {
      description: `${venue} · will be traded in LIVE mode`,
    });
    setSymbol("");
    setNote("");
    setMintAddress("");
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Kpi label="Total entries" value={watchlist.length.toString()} />
        <Kpi label="Manual overrides" value={manualCount.toString()} />
        <Kpi
          label="Auto-curated"
          value={autoCount.toString()}
          hint={autoCurate ? "curation on" : "curation off"}
          tone={autoCurate ? "success" : "muted"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-live" />
                Automated curation
              </span>
              <Switch checked={autoCurate} onCheckedChange={setAutoCurate} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              When enabled, the strategy engine adds tokens that pass the safety filter to the
              watchlist as{" "}
              <Badge variant="outline" className="text-[10px]">
                auto
              </Badge>{" "}
              candidates. After {AUTO_PROMOTE_STREAK} consecutive positive decisions you can promote
              them to <Badge className="bg-live text-live-foreground text-[10px]">manual</Badge>.
            </p>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2 text-xs">
              <span className="text-muted-foreground">
                {enabledCount} of {watchlist.length} enabled for live execution
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearAuto();
                  toast("Auto-curated entries cleared");
                }}
                disabled={autoCount === 0}
              >
                Clear auto
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
              <Filter className="h-4 w-4 text-warning" />
              Safety filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SliderRow
              label="Minimum safety score"
              value={safetyFilters.minSafety}
              min={0}
              max={100}
              step={5}
              suffix=" / 100"
              onChange={(v) => setSafetyFilters({ minSafety: v })}
            />
            <SliderRow
              label="Minimum liquidity"
              value={safetyFilters.minLiquiditySol}
              min={0}
              max={100}
              step={1}
              suffix=" SOL"
              onChange={(v) => setSafetyFilters({ minLiquiditySol: v })}
            />
            <SliderRow
              label="Max holder concentration"
              value={safetyFilters.maxHolderConcentrationPct}
              min={5}
              max={80}
              step={5}
              suffix="%"
              onChange={(v) => setSafetyFilters({ maxHolderConcentrationPct: v })}
            />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Toggle
                label="LP locked required"
                checked={safetyFilters.requireLpLocked}
                onChange={(v) => setSafetyFilters({ requireLpLocked: v })}
              />
              <Toggle
                label="Block honeypots"
                checked={safetyFilters.blockHoneypots}
                onChange={(v) => setSafetyFilters({ blockHoneypots: v })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Manual override</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="TOKEN/QUOTE"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-40 font-mono"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Select value={venue} onValueChange={(v) => setVenue(v as Venue)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="raydium">Raydium</SelectItem>
                <SelectItem value="pumpfun">Pump.fun</SelectItem>
                <SelectItem value="bsc">BSC</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Mint address (optional, Solana base58)"
              value={mintAddress}
              onChange={(e) => setMintAddress(e.target.value)}
              className="w-72 font-mono"
              maxLength={44}
            />
            <Input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 min-w-40"
              maxLength={200}
            />
            <Button onClick={handleAdd}>Add</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Manual entries bypass auto-curation but still pass the safety filter above.
          </p>
          <MintSafetyPreview mint={mintAddress} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium">
            <span>Curated universe</span>
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="all">
                  All <span className="ml-1 text-muted-foreground">{watchlist.length}</span>
                </TabsTrigger>
                <TabsTrigger value="manual">
                  Manual <span className="ml-1 text-muted-foreground">{manualCount}</span>
                </TabsTrigger>
                <TabsTrigger value="auto">
                  Auto <span className="ml-1 text-muted-foreground">{autoCount}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Safety</TableHead>
                <TableHead className="text-right">Liquidity</TableHead>
                <TableHead>Streak</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-xs text-muted-foreground"
                  >
                    Empty · add a token above or enable automated curation and start the bot
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((w) => {
                const canPromote = w.source === "auto" && w.positiveStreak >= AUTO_PROMOTE_STREAK;
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      <div className="font-mono text-sm font-semibold">{w.symbol}</div>
                      {w.note && <div className="text-[10px] text-muted-foreground">{w.note}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {w.venue}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {w.source === "auto" ? (
                        <Badge className="gap-1 bg-live text-live-foreground">
                          <Sparkles className="h-3 w-3" /> auto
                        </Badge>
                      ) : (
                        <Badge variant="secondary">manual</Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-xs", scoreTone(w.safety))}>
                      {w.safety}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {w.liquiditySol.toFixed(1)} SOL
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={(w.positiveStreak / AUTO_PROMOTE_STREAK) * 100}
                          className="h-1 w-16 [&>div]:bg-live"
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {w.positiveStreak}/{AUTO_PROMOTE_STREAK}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch checked={w.enabled} onCheckedChange={() => toggleWatch(w.id)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canPromote && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1"
                            onClick={() => {
                              promoteAuto(w.id);
                              toast.success(`Promoted ${w.symbol} to manual`);
                            }}
                          >
                            <CheckCircle2 className="h-3 w-3" /> Promote
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => removeWatch(w.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Remove</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "muted";
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-mono text-2xl font-semibold">{value}</div>
        </div>
        {hint && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] uppercase",
              tone === "success" && "border-success/40 text-success",
              tone === "muted" && "text-muted-foreground",
            )}
          >
            {hint}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border p-2 text-xs">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function scoreTone(n: number) {
  if (n >= 70) return "text-success";
  if (n >= 50) return "text-warning";
  return "text-danger";
}

// Suppress unused-import warning for X (kept for future close controls)
void X;

function MintSafetyPreview({ mint }: { mint: string }) {
  const trimmed = mint.trim();
  const valid = trimmed.length >= 32 && trimmed.length <= 44;
  const { data, isFetching, error } = useTokenSafety(valid ? trimmed : null);

  if (!trimmed) return null;
  if (!valid) {
    return (
      <div className="mt-3 rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Enter a full Solana mint (32–44 chars) to see a live rugcheck verdict.
      </div>
    );
  }
  if (isFetching && !data) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching rugcheck report…
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
        Rugcheck lookup failed. You can still add the token; safety will retry later.
      </div>
    );
  }
  if (!isSafetyVerdict(data)) {
    return (
      <div className="mt-3 rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Rugcheck has no report for this mint yet.
      </div>
    );
  }

  const v = data;
  const verdictTone =
    v.verdict === "safe"
      ? "border-success/40 bg-success/10 text-success"
      : v.verdict === "caution"
        ? "border-warning/40 bg-warning/10 text-warning"
        : v.verdict === "danger"
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-border/60 bg-muted/20 text-muted-foreground";

  const topRisks = v.risks
    .slice()
    .sort((a, b) => rankLevel(b.level) - rankLevel(a.level))
    .slice(0, 3);

  return (
    <div className={cn("mt-3 space-y-2 rounded border px-3 py-2 text-xs", verdictTone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {v.verdict === "safe" ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <span className="uppercase tracking-wide">Rugcheck: {v.verdict}</span>
          {v.symbol && <span className="text-muted-foreground">· {v.symbol}</span>}
        </div>
        <div className="font-mono">Score {v.score ?? "—"}/100</div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-foreground/80 sm:grid-cols-4">
        <AuthBadge label="Mint auth" revoked={v.flags.mintAuthorityRevoked} />
        <AuthBadge label="Freeze auth" revoked={v.flags.freezeAuthorityRevoked} />
        <div>
          LP locked:{" "}
          <span className={v.flags.lpLocked ? "text-success" : "text-danger"}>
            {v.flags.lpLocked == null
              ? "—"
              : v.flags.lpLocked
                ? `${Math.round(v.flags.lpLockedPct ?? 0)}%`
                : "no"}
          </span>
        </div>
        <div>
          Top holder:{" "}
          <span className="text-foreground">
            {v.flags.topHolderPct != null ? `${v.flags.topHolderPct.toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>

      {topRisks.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-foreground/80">
          {topRisks.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex gap-1.5">
              <span
                className={cn(
                  "font-mono uppercase",
                  r.level === "danger" || r.level === "high"
                    ? "text-danger"
                    : r.level === "warn" || r.level === "medium"
                      ? "text-warning"
                      : "text-muted-foreground",
                )}
              >
                [{r.level}]
              </span>
              <span className="truncate">{r.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuthBadge({ label, revoked }: { label: string; revoked: boolean }) {
  return (
    <div>
      {label}:{" "}
      <span className={revoked ? "text-success" : "text-danger"}>
        {revoked ? "revoked" : "active"}
      </span>
    </div>
  );
}

function rankLevel(l: string) {
  return l === "danger" || l === "high" ? 3 : l === "warn" || l === "medium" ? 2 : 1;
}
