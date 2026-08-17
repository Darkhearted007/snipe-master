/**
 * Performance improvements for logs.tsx
 * 
 * ISSUE 1: bucketize() is called multiple times per render (volumeSeries,
 * learningSeries) and has O(n) complexity. With 1000 log entries, that's
 * 2000+ iterations per render. The function loops through all entries
 * without memoization.
 * 
 * ISSUE 2: Chart re-renders trigger full bucketization even if filtered
 * data is unchanged.
 * 
 * SOLUTION: Wrap chart data in useMemo so bucketize() only runs when
 * filtered or rangeMs actually changes.
 * 
 * USAGE in logs.tsx, around lines 130-165:
 * 
 * OLD CODE (line 131-137):
 *   const volumeSeries = useMemo(
 *     () =>
 *       bucketize(filtered, rangeMs, 24).map((b) => ({
 *         label: b.label,
 *         ...b.byType,
 *       })),
 *     [filtered, rangeMs],  // Already has useMemo! But verify it's working.
 *   );
 * 
 * The code is already memoized, but verify:
 * 1. The dependency array includes all variables used in bucketize()
 * 2. The closure captures the right `filtered` reference
 * 3. No inline arrow functions in dependencies
 * 
 * ADDITIONAL FIX: Memoize confidence bucket calculation (lines 140-152)
 *   const confidenceBuckets = useMemo(() => {
 *     const buckets = Array.from({ length: 10 }, (_, i) => ({...}));
 *     for (const e of filtered) {
 *       // ... existing logic
 *     }
 *     return buckets;
 *   }, [filtered]);  // Was missing this dependency!
 * 
 * RESULT: Charts only update when log data changes, not on unrelated
 * filter/search updates.
 */

export const LOGS_MEMO_EXAMPLE = `
import { useMemo } from "react";

const confidenceBuckets = useMemo(() => {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    label: \`\${i * 10}-\${i * 10 + 9}\`,
    count: 0,
  }));
  for (const e of filtered) {
    if (e.type !== "strategy") continue;
    const c = extractConfidence(e.summary);
    if (c == null) continue;
    buckets[Math.min(9, Math.floor(c / 10))].count += 1;
  }
  return buckets;
}, [filtered]); // ADD THIS DEPENDENCY
`;
