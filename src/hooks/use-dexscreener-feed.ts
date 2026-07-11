import { useQuery } from "@tanstack/react-query";

export type DexFeed =
  | "token-profiles/latest/v1"
  | "token-profiles/recent-updates/v1"
  | "token-boosts/latest/v1"
  | "token-boosts/top/v1"
  | "community-takeovers/latest/v1"
  | "ads/latest/v1";

export interface DexTokenProfile {
  url?: string;
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: { label?: string; type?: string; url: string }[];
}

export interface DexBoost extends DexTokenProfile {
  amount?: number;
  totalAmount?: number;
}

async function fetchFeed<T>(feed: DexFeed): Promise<T[]> {
  const res = await fetch(`/api/dexscreener?feed=${encodeURIComponent(feed)}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`DexScreener ${feed} → ${res.status}`);
  const data = (await res.json()) as unknown;
  // The DexScreener endpoints return either an array or an object with error.
  if (Array.isArray(data)) return data as T[];
  return [];
}

const commonOpts = {
  refetchIntervalInBackground: true,
  retry: 2,
  retryDelay: (i: number) => Math.min(30_000, 1_000 * 2 ** i),
};

export function useDexScreenerFeeds() {
  const latest = useQuery({
    queryKey: ["dex", "token-profiles/latest/v1"],
    queryFn: () => fetchFeed<DexTokenProfile>("token-profiles/latest/v1"),
    refetchInterval: 20_000,
    staleTime: 15_000,
    ...commonOpts,
  });
  const topBoosts = useQuery({
    queryKey: ["dex", "token-boosts/top/v1"],
    queryFn: () => fetchFeed<DexBoost>("token-boosts/top/v1"),
    refetchInterval: 30_000,
    staleTime: 25_000,
    ...commonOpts,
  });
  const latestBoosts = useQuery({
    queryKey: ["dex", "token-boosts/latest/v1"],
    queryFn: () => fetchFeed<DexBoost>("token-boosts/latest/v1"),
    refetchInterval: 25_000,
    staleTime: 20_000,
    ...commonOpts,
  });
  return { latest, topBoosts, latestBoosts };
}
