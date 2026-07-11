import { useMemo } from "react";
import { Radio, RefreshCw, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDexScreenerFeeds, type DexBoost } from "@/hooks/use-dexscreener-feed";

function shortAddr(a?: string) {
  if (!a) return "";
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function DexScreenerCard() {
  const { latest, topBoosts } = useDexScreenerFeeds();

  const status = useMemo(() => {
    if (latest.isLoading || topBoosts.isLoading) return "loading";
    if (latest.isError && topBoosts.isError) return "offline";
    if (latest.isError || topBoosts.isError) return "degraded";
    return "live";
  }, [latest.isLoading, latest.isError, topBoosts.isLoading, topBoosts.isError]);

  const tokens = (topBoosts.data ?? []).slice(0, 6);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Radio className="h-4 w-4 text-live" />
          DexScreener live feed
        </CardTitle>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <button
            type="button"
            onClick={() => {
              void latest.refetch();
              void topBoosts.refetch();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${latest.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Top boosted tokens
        </div>
        {tokens.length === 0 && status === "loading" && (
          <div className="space-y-1.5">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        )}
        {tokens.length === 0 && status !== "loading" && (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            No boosted tokens returned. Feed will retry automatically.
          </div>
        )}
        <ul className="space-y-1">
          {tokens.map((t: DexBoost, i) => (
            <li
              key={`${t.tokenAddress}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                {t.icon ? (
                  <img
                    src={t.icon}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-full bg-muted"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-6 w-6 shrink-0 rounded-full bg-muted" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs">{shortAddr(t.tokenAddress)}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {t.chainId ?? "chain?"} · {(t.description ?? "").slice(0, 40)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <TrendingUp className="h-3 w-3 text-success" />
                <span className="font-mono">{Math.round(t.totalAmount ?? t.amount ?? 0)}</span>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-muted-foreground">
          Polled server-side every 20–30s from api.dexscreener.com. Note: those URLs are HTTPS REST,
          not WebSocket — a WS connection would fail.
        </p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: "loading" | "live" | "degraded" | "offline" }) {
  const map = {
    loading: { label: "Connecting", cls: "bg-muted text-muted-foreground" },
    live: { label: "Live", cls: "bg-success/20 text-success border-success/40" },
    degraded: { label: "Degraded", cls: "bg-warning/20 text-warning border-warning/40" },
    offline: { label: "Offline", cls: "bg-danger/20 text-danger border-danger/40" },
  } as const;
  const { label, cls } = map[status];
  return <Badge className={`gap-1 text-[10px] ${cls}`}>{label}</Badge>;
}
