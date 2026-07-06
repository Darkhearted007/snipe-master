import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBotStore } from "@/lib/bot-store";
import type { DecisionType } from "@/lib/bot-types";
import { cn } from "@/lib/utils";

const TYPES: DecisionType[] = ["feed", "safety", "strategy", "execution", "learning"];

const toneFor: Record<DecisionType, string> = {
  feed: "bg-muted text-muted-foreground",
  safety: "bg-live/20 text-live",
  strategy: "bg-warning/20 text-warning",
  execution: "bg-success/20 text-success",
  learning: "bg-secondary text-secondary-foreground",
};

export function DecisionsLog({ limit = 30 }: { limit?: number }) {
  const log = useBotStore((s) => s.log);
  const [filters, setFilters] = useState<Set<DecisionType>>(new Set(TYPES));

  const toggle = (t: DecisionType) => {
    const next = new Set(filters);
    next.has(t) ? next.delete(t) : next.add(t);
    setFilters(next);
  };

  const visible = log.filter((l) => filters.has(l.type)).slice(0, limit);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>Decision Log</span>
          <div className="flex flex-wrap gap-1">
            {TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggle(t)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] uppercase tracking-wider transition-opacity",
                  toneFor[t],
                  !filters.has(t) && "opacity-30",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-96 overflow-auto">
          <ul className="divide-y">
            {visible.length === 0 && (
              <li className="py-8 text-center text-xs text-muted-foreground">
                Log empty
              </li>
            )}
            {visible.map((l) => (
              <li
                key={l.id}
                className="flex items-start gap-3 px-4 py-2 text-xs animate-in fade-in duration-200"
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
                </span>
                <Badge
                  variant="secondary"
                  className={cn("h-4 rounded px-1.5 text-[9px] uppercase", toneFor[l.type])}
                >
                  {l.type}
                </Badge>
                <span className="flex-1 font-mono">{l.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
