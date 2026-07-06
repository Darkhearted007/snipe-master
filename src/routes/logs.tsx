import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DecisionsLog } from "@/components/decisions-log";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBotStore } from "@/lib/bot-store";

export const Route = createFileRoute("/logs")({
  head: () => ({ meta: [{ title: "Logs — SniperBot" }] }),
  component: LogsPage,
});

function LogsPage() {
  const log = useBotStore((s) => s.log);
  const [q, setQ] = useState("");
  const filtered = log.filter((l) =>
    l.summary.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Search decision log</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search token, event, reason…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="font-mono"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {filtered.length} / {log.length} events
          </p>
        </CardContent>
      </Card>
      <DecisionsLog limit={200} />
    </div>
  );
}
