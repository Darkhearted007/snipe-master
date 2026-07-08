import { createFileRoute } from "@tanstack/react-router";
import { EquityCard } from "@/components/equity-card";
import { GuardrailsCard } from "@/components/guardrails-card";
import { OpportunityFeed } from "@/components/opportunity-feed";
import { PositionsCard } from "@/components/positions-card";
import { DecisionsLog } from "@/components/decisions-log";
import { DexScreenerCard } from "@/components/dexscreener-card";

export const Route = createFileRoute("/")({
  component: Overview,
});

function Overview() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <EquityCard />
          <GuardrailsCard />
        </div>
        <DexScreenerCard />
        <OpportunityFeed />
        <PositionsCard />
      </div>
      <div className="xl:col-span-1">
        <DecisionsLog />
      </div>
    </div>
  );
}

