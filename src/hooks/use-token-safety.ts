import { useQuery } from "@tanstack/react-query";
import type { SafetyVerdict } from "@/routes/api/rugcheck.$mint";

/** Fetch real on-chain safety verdict for a Solana mint via rugcheck.xyz.
 *  Returns undefined while loading; a `{ ok: false }` object on upstream
 *  failure so the UI can show "unknown" without throwing. */
export function useTokenSafety(mint: string | null | undefined) {
  return useQuery<SafetyVerdict | { ok: false; error: string; mint: string }>({
    queryKey: ["safety", mint],
    enabled: !!mint && mint.length >= 32,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/rugcheck/${encodeURIComponent(mint!)}`);
      if (!res.ok) throw new Error(`safety fetch failed (${res.status})`);
      return res.json();
    },
    retry: 1,
  });
}
