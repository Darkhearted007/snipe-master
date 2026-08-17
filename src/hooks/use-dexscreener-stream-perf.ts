/**
 * Performance improvements for use-dexscreener-stream.ts
 * 
 * ISSUES:
 * 1. Fire-and-forget safety checks accumulate without backpressure
 * 2. Multiple poll queries can discover the same mint repeatedly
 * 3. No timeout on safety check requests
 * 
 * SOLUTIONS:
 * 1. Add a Semaphore to limit concurrent safety checks to 3
 * 2. Deduplicate mints across query results before processing
 * 3. Add 10s timeout to fetchSafetyVerdict() calls
 * 
 * USAGE in use-dexscreener-stream.ts:
 * 
 * const safetyCheckSemaphore = new Semaphore(3);
 * const seenMints = new Set<string>();
 * 
 * // In fetchPairs loop, deduplicate first:
 * const uniquePairs = [];
 * for (const pair of allPairs) {
 *   if (!seenMints.has(pair.baseToken?.address)) {
 *     seenMints.add(pair.baseToken?.address);
 *     uniquePairs.push(pair);
 *   }
 * }
 * 
 * // Then for each unique pair:
 * if (oppId && mint) {
 *   safetyCheckSemaphore.run(async () => {
 *     const { controller, cleanup } = createTimeoutController(10_000);
 *     try {
 *       const v = await fetchSafetyVerdict(mint, controller.signal);
 *       applySafetyVerdict({ opportunityId: oppId, ...v });
 *     } finally {
 *       cleanup();
 *     }
 *   }).catch(e => logStructured(e, {...}));
 * }
 */

import { Semaphore, createTimeoutController } from "@/lib/performance-utils";

export const SAFETY_CHECK_SEMAPHORE = new Semaphore(3);
export const SAFETY_CHECK_TIMEOUT_MS = 10_000;

/**
 * Deduplicate pairs by mint address.
 * Prevents the same token from being discovered multiple times
 * when it appears in results from multiple queries ("SOL", "raydium", "pumpfun").
 */
export function deduplicatePairsByMint(
  pairs: Array<{ baseToken?: { address?: string } }>,
): Array<{ baseToken?: { address?: string } }> {
  const seen = new Set<string>();
  const unique = [];

  for (const pair of pairs) {
    const mint = pair.baseToken?.address;
    if (mint && !seen.has(mint)) {
      seen.add(mint);
      unique.push(pair);
    }
  }

  return unique;
}
