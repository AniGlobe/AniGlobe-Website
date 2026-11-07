/**
 * In-memory fixed-window rate limiter for auth endpoints.
 *
 * Per key: { count, resetAt }. When the window expires the counter restarts.
 * This is a single-process limiter — correct for the current deployment.
 * If AniGlobe ever runs multi-instance, this moves to the database / a shared
 * store with the same interface (consume(key) -> {allowed, retryAfterMs}).
 */

export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, now = () => Date.now() } = {}) {
  const buckets = new Map();

  function prune(current) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key);
    }
  }

  return {
    consume(key) {
      const current = now();
      prune(current);
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

    clear() {
      buckets.clear();
    },
  };
}
