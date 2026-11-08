/**
 * Persisted rate limiter backed by SQLite (api/server/db.js -> rate_limits).
 *
 * Counters survive restarts and are consistent for every request the process
 * serves (or every serverless instance, since the counters live in the
 * database, not in memory). The consume() interface is unchanged so routes
 * keep working as before.
 */

import { consumeRateLimit, pruneRateLimits } from './db.js';

export function createDbRateLimiter({ db, windowMs = 15 * 60 * 1000, max = 10, pruneOnUse = true } = {}) {
  let lastPrune = 0;
  const now = () => Date.now();

  return {
    async consume(key) {
      const current = now();
      if (pruneOnUse && current - lastPrune > 60 * 1000) {
        lastPrune = current;
        await pruneRateLimits(db, current);
      }
      return consumeRateLimit(db, key, windowMs, max, current);
    },
  };
}

/** In-memory variant kept for unit tests that do not need a database. */
export function createMemoryRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, now = () => Date.now() } = {}) {
  const buckets = new Map();

  return {
    consume(key) {
      const current = now();
      for (const [k, bucket] of buckets) {
        if (bucket.resetAt <= current) buckets.delete(k);
      }
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= current) {
        buckets.set(key, { count: 1, resetAt: current + windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (existing.count >= max) {
        return { allowed: false, retryAfterMs: existing.resetAt - current };
      }
      existing.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
