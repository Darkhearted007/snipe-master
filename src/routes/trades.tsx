import { createFileRoute } from "@tanstack/react-router";
import { PositionsCard } from "@/components/positions-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBotStore } from "@/lib/bot-store";

export const Route = createFileRoute("/trades")({
  head: () => ({
    meta: [{ title: "Trades — SniperBot" }],
  }),
  component: TradesPage,
});

function TradesPage() {
  const log = useBotStore((s) =>
    s.log.filter((l) => l.type === "execution"),
  );

  return (
    <div className="grid gap-4">
      <PositionsCard />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Execution history</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No trades yet
            </p>
          ) : (
            <ul className="divide-y text-xs">
              {log.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 py-2 font-mono">
                  <span className="text-muted-foreground">
                    {new Date(l.ts).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className="flex-1">{l.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
