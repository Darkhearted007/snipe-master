/**
 * Performance patch for bot-store.ts
 * 
 * ISSUE: The log array grows unboundedly and is persisted to localStorage.
 * This causes memory leaks and serialization bottlenecks on long-running sessions.
 * 
 * SOLUTION: Replace the unbounded array with a circular buffer that keeps only
 * the last MAX_LOG entries in memory.
 * 
 * USAGE:
 * 1. Import CircularBuffer from performance-utils
 * 2. In bot-store.ts initial state, change:
 *    - OLD: log: [] as DecisionLogEntry[]
 *    - NEW: log: [] as DecisionLogEntry[]  (same, but managed differently)
 * 3. In the persist middleware, update partialize to convert CircularBuffer to array
 * 4. In each set() that modifies log, use: log: prepend(...).slice(0, MAX_LOG)
 * 
 * This is already done in the updated bot-store.ts — the MAX_LOG constant
 * enforces a hard cap of 300 entries.
 * 
 * RESULT:
 * - Memory usage capped: ~300 entries × ~100 bytes = ~30KB (was unbounded)
 * - localStorage payload stable: serializes only last 300 entries
 * - Performance: no change to consumers (still an array)
 */

export const MAX_LOG_ENTRIES = 300;
