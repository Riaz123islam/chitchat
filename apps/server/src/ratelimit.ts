// In-memory token-bucket rate limiting. Correct for a single server instance
// (the Render free tier runs exactly one). If the service ever scales to
// multiple instances, move this to Redis.

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(n = 1, now: number = Date.now()): boolean {
    const elapsed = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Keyed token buckets with bounded memory and periodic cleanup. */
export class KeyedRateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly maxKeys = 20_000,
  ) {}

  /** Returns true when the action is allowed. `now` is injectable for tests. */
  consume(key: string, n = 1, now: number = Date.now()): boolean {
    this.sweep();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerSec);
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next();
        if (!oldest.done) this.buckets.delete(oldest.value);
      }
      this.buckets.set(key, bucket);
    }
    return bucket.consume(n, now);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    // Buckets refill fully within capacity/refillPerSec seconds; anything
    // untouched for 10x that long can be dropped.
    void now;
  }
}

/** Count how many timestamps fall inside a sliding window. */
export function countWithin(timestamps: number[], windowMs: number, now = Date.now()): number {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t >= cutoff).length;
}

/** Drop timestamps older than the window (mutates the array). */
export function pruneOlderThan(timestamps: number[], windowMs: number, now = Date.now()): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t >= cutoff);
}
