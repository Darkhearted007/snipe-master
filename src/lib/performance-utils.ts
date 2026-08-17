/**
 * Circular buffer for bounded memory usage.
 * Automatically discards oldest entries when max capacity is reached.
 */
export class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
  }

  push(...items: T[]): void {
    for (const item of items) {
      this.buffer.push(item);
      if (this.buffer.length > this.maxSize) {
        this.buffer.shift();
      }
    }
  }

  slice(start?: number, end?: number): T[] {
    return this.buffer.slice(start, end);
  }

  get length(): number {
    return this.buffer.length;
  }

  toArray(): T[] {
    return [...this.buffer];
  }
}

/**
 * LRU cache for expensive computations.
 * Automatically evicts oldest entries when capacity is exceeded.
 */
export class LRUCache<K, V> {
  private map = new Map<K, { value: V; ts: number }>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 100, ttlMs: number = 10 * 60 * 1000) {
    this.maxSize = Math.max(1, maxSize);
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove if exists (so we can move it to end)
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    // Add to end
    this.map.set(key, { value, ts: Date.now() });

    // Evict oldest if over capacity
    if (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}

/**
 * Semaphore for limiting concurrent async operations.
 * Queues excess requests and processes them as slots become available.
 */
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // Queue and wait for a release
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }

  /**
   * Run a function with semaphore protection.
   * Automatically acquires before and releases after.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Create an AbortController with a built-in timeout.
 */
export function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    controller,
    cleanup: () => clearTimeout(timeout),
  };
}
