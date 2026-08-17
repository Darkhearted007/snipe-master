/**
 * Performance improvements for watchlist.tsx
 * 
 * ISSUE: The counts (manualCount, autoCount, enabledCount) are recalculated
 * on every render, even when watchlist hasn't changed. With 100+ entries,
 * this is 3x unnecessary .filter() calls per render.
 * 
 * SOLUTION: Wrap these in useMemo so they only recalculate when watchlist changes.
 * 
 * USAGE in watchlist.tsx, around line 90:
 * 
 * OLD CODE:
 *   const manualCount = watchlist.filter((w) => w.source === "manual").length;
 *   const autoCount = watchlist.filter((w) => w.source === "auto").length;
 *   const enabledCount = watchlist.filter((w) => w.enabled).length;
 * 
 * NEW CODE:
 *   const manualCount = useMemo(
 *     () => watchlist.filter((w) => w.source === "manual").length,
 *     [watchlist],
 *   );
 *   const autoCount = useMemo(
 *     () => watchlist.filter((w) => w.source === "auto").length,
 *     [watchlist],
 *   );
 *   const enabledCount = useMemo(
 *     () => watchlist.filter((w) => w.enabled).length,
 *     [watchlist],
 *   );
 * 
 * RESULT: Counts recalculate only when watchlist actually changes, not on
 * unrelated renders (e.g., when safety filters slider moves).
 */

export const WATCHLIST_MEMO_EXAMPLE = `
import { useMemo } from "react";

const manualCount = useMemo(
  () => watchlist.filter((w) => w.source === "manual").length,
  [watchlist],
);

const autoCount = useMemo(
  () => watchlist.filter((w) => w.source === "auto").length,
  [watchlist],
);

const enabledCount = useMemo(
  () => watchlist.filter((w) => w.enabled).length,
  [watchlist],
);
`;
