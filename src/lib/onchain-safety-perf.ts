/**
 * Performance improvements for onchain-safety.ts
 * 
 * ISSUE: Each safety check makes fresh RPC calls (getTokenLargestAccounts,
 * getAccountInfo) even if the same mint was checked moments before.
 * With 100 discoveries per session, this triggers 300+ RPC calls and
 * rapid rate-limit hits.
 * 
 * SOLUTION: Cache safety evaluation results for 10 minutes.
 * Since safety doesn't change within a session, this is safe and reduces
 * RPC load by 90%+ when the same tokens are rediscovered.
 * 
 * USAGE in onchain-safety.ts:
 * 
 * import { LRUCache } from '@/lib/performance-utils';
 * 
 * const SAFETY_CACHE = new LRUCache<string, SafetyResult>(50, 10 * 60 * 1000);
 * 
 * export async function evaluateMintSafety(
 *   mint: string,
 *   lpMint: string | null = null,
 * ): Promise<SafetyResult> {
 *   // Check cache first
 *   const cached = SAFETY_CACHE.get(mint);
 *   if (cached) return cached;
 * 
 *   // ... existing evaluation logic ...
 *   const result = { mint, authority, holders, lpStatus, honeypot, score, reasons, evaluatedAt };
 * 
 *   // Cache result before returning
 *   SAFETY_CACHE.set(mint, result);
 *   return result;
 * }
 */

import { LRUCache } from "@/lib/performance-utils";

export const SAFETY_EVALUATION_CACHE = new LRUCache(
  50, // Keep 50 mints' safety data
  10 * 60 * 1000, // 10 minute TTL
);

/**
 * Clears the safety cache. Call on session reset or debug.
 */
export function clearSafetyCache(): void {
  SAFETY_EVALUATION_CACHE.clear();
}
