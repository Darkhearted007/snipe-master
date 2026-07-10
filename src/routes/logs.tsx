import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBotStore } from "@/lib/bot-store";
import type { DecisionLogEntry, DecisionType } from "@/lib/bot-types";
import { DecisionsLog } from "@/components/decisions-log";

export const Route = createFileRoute("/logs")({
  head: () => ({ meta: [{ title: "Decisions & Learning — SniperBot" }] }),
  component: LogsPage,
});

// All log types, in a consistent order for chart stacking & filter chips.
const ALL_TYPES: DecisionType[] = [
  "feed",
  "safety",
  "strategy",
  "execution",
  "learning",
  "audit",
  "wallet",
  "error",
];

// hsl() references so the palette follows the design tokens (dark theme).
const TYPE_COLOR: Record<DecisionType, string> = {
  feed: "hsl(215 90% 65%)",
  safety: "hsl(45 95% 60%)",
  strategy: "hsl(280 80% 65%)",
  execution: "hsl(160 70% 50%)",
  learning: "hsl(190 85% 55%)",
  audit: "hsl(140 60% 55%)",
  wallet: "hsl(30 90% 60%)",
  error: "hsl(0 80% 60%)",
};

const RANGES = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  all: Number.POSITIVE_INFINITY,
} as const;
type RangeKey = keyof typeof RANGES;

/** Parse "confidence 72%" out of a strategy summary, if present. */
function extractConfidence(summary: string): number | null {
  const m = summary.match(/confidence\s+(\d{1,3})%/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
}

/** Bucketize into ~24 slots across the visible range for volume/learning charts. */
function bucketize(
  entries: DecisionLogEntry[],
  rangeMs: number,
  buckets = 24,
): {
  ts: number;
  label: string;
  total: number;
  byType: Record<DecisionType, number>;
}[] {
  if (!entries.length) return [];
  const now = Date.now();
  const span =
    rangeMs === Number.POSITIVE_INFINITY
      ? Math.max(60_000, now - Math.min(...entries.map((e) => e.ts)))
      : rangeMs;
  const start = now - span;
  const width = span / buckets;
  const slots = Array.from({ length: buckets }, (_, i) => {
    const ts = start + i * width;
    return {
      ts,
      label: format(new Date(ts), span > 6 * 60 * 60_000 ? "HH:mm" : "HH:mm:ss"),
      total: 0,
      byType: Object.fromEntries(ALL_TYPES.map((t) => [t, 0])) as Record<
        DecisionType,
        number
      >,
    };
  });
  for (const e of entries) {
    if (e.ts < start) continue;
    const idx = Math.min(
      buckets - 1,
      Math.max(0, Math.floor((e.ts - start) / width)),
    );
    slots[idx].total += 1;
    slots[idx].byType[e.type] += 1;
  }
  return slots;
}

function LogsPage() {
  const log = useBotStore((s) => s.log);
  const [q, setQ] = useState("");
  const [range, setRange] = useState<RangeKey>("1h");
  const [types, setTypes] = useState<Set<DecisionType>>(
    new Set(ALL_TYPES),
  );

  const rangeMs = RANGES[range];
  const cutoff = Date.now() - rangeMs;

  const inRange = useMemo(
    () => log.filter((l) => l.ts >= cutoff),
    [log, cutoff],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inRange.filter(
      (l) =>
        types.has(l.type) &&
        (!needle || l.summary.toLowerCase().includes(needle)),
    );
  }, [inRange, types, q]);

  // ---- Chart data ---------------------------------------------------------

  // 1. Event volume over time, stacked by type (uses `filtered` so chart
  //    reacts to filters — otherwise the chart contradicts the table).
  const volumeSeries = useMemo(
    () =>
      bucketize(filtered, rangeMs, 24).map((b) => ({
        label: b.label,
        ...b.byType,
      })),
    [filtered, rangeMs],
  );

  // 2. Confidence distribution — 10-bucket histogram from strategy events.
  const confidenceBuckets = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      label: `${i * 10}-${i * 10 + 9}`,
      count: 0,
    }));
    for (const e of filtered) {
      if (e.type !== "strategy") continue;
      const c = extractConfidence(e.summary);
      if (c == null) continue;
      buckets[Math.min(9, Math.floor(c / 10))].count += 1;
    }
    return buckets;
  }, [filtered]);

  const confidenceSamples = confidenceBuckets.reduce(
    (a, b) => a + b.count,
    0,
  );

  // 3. Learning feedback timeline — count of `learning` events per bucket.
  const learningSeries = useMemo(
    () =>
      bucketize(
        filtered.filter((f) => f.type === "learning"),
        rangeMs,
        24,
      ).map((b) => ({ label: b.label, learning: b.total })),
    [filtered, rangeMs],
  );

  // ---- Counters -----------------------------------------------------------
  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_TYPES.map((t) => [t, 0])) as Record<
      DecisionType,
      number
    >;
    for (const e of inRange) c[e.type] += 1;
    return c;
  }, [inRange]);

  const toggleType = (t: DecisionType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  return (
    <div className="grid gap-4">
      {/* --- Filter bar ---------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Decision & learning review
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={range === k ? "default" : "outline"}
                onClick={() => setRange(k)}
                className="h-7 font-mono text-xs"
              >
                {k}
              </Button>
            ))}
            <Input
              placeholder="Search token, event, reason…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="ml-auto max-w-sm font-mono"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_TYPES.map((t) => {
              const active = types.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className="focus:outline-none"
                  aria-pressed={active}
                >
                  <Badge
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer gap-1.5 font-mono text-[10px] uppercase tracking-wide"
                    style={
                      active
                        ? { backgroundColor: TYPE_COLOR[t], color: "#000" }
                        : { borderColor: TYPE_COLOR[t], color: TYPE_COLOR[t] }
                    }
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: TYPE_COLOR[t] }}
                    />
                    {t} · {counts[t]}
                  </Badge>
                </button>
              );
            })}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setTypes(new Set(ALL_TYPES))}
            >
              all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setTypes(new Set())}
            >
              none
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {inRange.length} events in {range} · {log.length}{" "}
            total in memory
          </p>
        </CardContent>
      </Card>

      {/* --- Charts row ---------------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Event volume by type
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeSeries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 11,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {ALL_TYPES.filter((t) => types.has(t)).map((t) => (
                  <Bar
                    key={t}
                    dataKey={t}
                    stackId="a"
                    fill={TYPE_COLOR[t]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Strategy confidence distribution ({confidenceSamples} samples)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {confidenceSamples === 0 ? (
              <div className="grid h-full place-items-center text-xs text-muted-foreground">
                No strategy decisions with parseable confidence in this window.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={confidenceBuckets} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="count" isAnimationActive={false}>
                    {confidenceBuckets.map((_, i) => (
                      <Cell
                        key={i}
                        // 0-49 red-ish, 50-69 amber, 70+ green — matches the
                        // simulator's execution threshold at 55%.
                        fill={
                          i < 5
                            ? "hsl(0 70% 55%)"
                            : i < 7
                              ? "hsl(45 90% 55%)"
                              : "hsl(150 65% 50%)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Learning feedback updates over time
          </CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={learningSeries} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 11,
                }}
              />
              <Line
                type="monotone"
                dataKey="learning"
                stroke={TYPE_COLOR.learning}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* --- Filtered event stream ---------------------------------------- */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Filtered events</CardTitle>
          <span className="font-mono text-[10px] text-muted-foreground">
            {filtered.length} rows
          </span>
        </CardHeader>
        <CardContent className="max-h-[540px] overflow-auto p-0">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Confidence</th>
                <th className="px-3 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((e) => {
                const c = extractConfidence(e.summary);
                return (
                  <tr
                    key={e.id}
                    className="border-t border-border/50 hover:bg-muted/30"
                  >
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {format(new Date(e.ts), "HH:mm:ss")}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-[10px] uppercase"
                        style={{
                          backgroundColor: `${TYPE_COLOR[e.type]}22`,
                          color: TYPE_COLOR[e.type],
                        }}
                      >
                        {e.type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {c != null ? `${c}%` : "—"}
                    </td>
                    <td className="px-3 py-1.5">{e.summary}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-8 text-center text-muted-foreground"
                  >
                    No events match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Keep legacy live-tail feed for parity with the dashboard. */}
      <DecisionsLog limit={100} />
    </div>
  );
}
