import { useQuery } from "@tanstack/react-query";

export interface DiscoveryCandidateRow {
  mint: string;
  decimals: number;
  venue: string;
  symbol: string;
  discovered_at: string;
  safety_score: number | null;
  liquidity_usd: number | null;
}

async function fetchCandidates(): Promise<DiscoveryCandidateRow[]> {
  const res = await fetch("/api/discovery", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`discovery feed → ${res.status}`);
  const data = (await res.json()) as { candidates?: DiscoveryCandidateRow[] };
  return data.candidates ?? [];
}

/** Polls real Helius-webhook-sourced pool/token candidates for live mode. */
export function useDiscoveryFeed(enabled: boolean) {
  return useQuery({
    queryKey: ["discovery-candidates"],
    queryFn: fetchCandidates,
    enabled,
    refetchInterval: 8_000,
    staleTime: 5_000,
    retry: 2,
  });
}
