/** Shared exponential-backoff helpers for stream reconnect and network writes.
 *  Full jitter (AWS-style) avoids retry stampedes when many operations fail at
 *  the same time (e.g. a brief network outage). */

export type BackoffOptions = {
  /** First delay in ms (before jitter). Default 500. */
  baseMs?: number;
  /** Hard cap on the delay in ms. Default 30_000. */
  maxMs?: number;
  /** Cap on attempts before giving up. Default 6. */
  maxAttempts?: number;
  /** Multiplier per attempt. Default 2. */
  factor?: number;
};

/** Full-jitter backoff: random(0, min(cap, base * factor^attempt)). */
export function computeBackoff(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs = 500, maxMs = 30_000, factor = 2 } = opts;
  const exp = Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, attempt)));
  return Math.floor(Math.random() * exp);
}

/** Await an exponential-backoff sleep for `attempt` (0-indexed). */
export function sleepBackoff(attempt: number, opts?: BackoffOptions): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, computeBackoff(attempt, opts)));
}

/** Retry an async operation with full-jitter backoff.
 *  Throws the last error if `maxAttempts` is exhausted.
 *  `shouldRetry` lets callers skip retry for permanent errors (e.g. 401/403). */
export async function retryWithBackoff<T>(
  op: () => Promise<T>,
  opts: BackoffOptions & {
    onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const { maxAttempts = 6, onRetry, shouldRetry } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await op();
    } catch (e) {
      lastError = e;
      if (shouldRetry && !shouldRetry(e)) throw e;
      if (attempt === maxAttempts - 1) break;
      const delay = computeBackoff(attempt, opts);
      onRetry?.(attempt + 1, delay, e);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/** True for errors that should NOT be retried (auth, validation, 4xx). */
export function isPermanentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(401|403|404|422|Unauthorized|Forbidden|Invalid input)\b/i.test(msg);
}
