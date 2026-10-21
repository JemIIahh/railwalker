export interface RateLimiter {
  take(key: string): { ok: boolean; retryAfterSec: number };
}

export interface TokenBucket extends RateLimiter {
  /** How many keys are tracked right now. */
  size(): number;
}

interface Bucket {
  tokens: number;
  at: number;
}

const DEFAULT_MAX_KEYS = 10_000;
/**
 * Floating point: `(1 - tokens) / refill` can land a hair above a whole number (six seconds becomes seven), and a bucket refilled for
 * exactly the advertised wait can hold 0.9999999999999999. Both comparisons forgive it, so obeying retry-after always works.
 */
const EPSILON = 1e-9;

/**
 * In-memory, per key. Each key starts full and refills continuously; a refused request costs nothing. Memory is bounded: past
 * `maxKeys` the least recently used key is forgotten (and would start full again), so a caller cannot grow the table by being many.
 * One instance per server process: good enough to blunt a loop, not a quota across a fleet.
 */
export function tokenBucket(opts: { capacity: number; refillPerSec: number; now: () => number; maxKeys?: number }): TokenBucket {
  const { capacity, refillPerSec, now } = opts;
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  if (!Number.isFinite(capacity) || capacity <= 0) throw new RangeError('capacity must be a positive number');
  if (!Number.isFinite(refillPerSec) || refillPerSec <= 0) throw new RangeError('refillPerSec must be a positive number');
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new RangeError('maxKeys must be a positive integer');

  const buckets = new Map<string, Bucket>(); // insertion order is recency order: a touched key is re-inserted last

  return {
    take(key) {
      const t = now();
      const known = buckets.get(key);
      buckets.delete(key);
      const at = known ? Math.max(known.at, t) : t; // a clock that steps backwards must not mint tokens later
      const elapsedSec = known ? Math.max(0, (t - known.at) / 1000) : 0;
      const bucket: Bucket = { tokens: known ? Math.min(capacity, known.tokens + elapsedSec * refillPerSec) : capacity, at };

      let result: { ok: boolean; retryAfterSec: number };
      if (bucket.tokens >= 1 - EPSILON) {
        bucket.tokens = Math.max(0, bucket.tokens - 1);
        result = { ok: true, retryAfterSec: 0 };
      } else {
        result = { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSec - EPSILON)) };
      }

      buckets.set(key, bucket);
      while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value as string);
      return result;
    },
    size: () => buckets.size,
  };
}
