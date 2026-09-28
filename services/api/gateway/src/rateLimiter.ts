/**
 * API Gateway — Per-key rate limiter with access tiers
 *
 * Token-bucket per API key: each tier gets a request budget per window.
 * `consume()` returns true when allowed, false when rate-limited. Budgets
 * reset automatically when the window elapses; `reset(key)` forces it.
 *
 * Issue #753
 */

import { AccessTier } from "./types";

const TIER_LIMITS: Record<AccessTier, { maxRequests: number; windowMs: number }> = {
  free: { maxRequests: 60, windowMs: 60_000 },
  standard: { maxRequests: 600, windowMs: 60_000 },
  enterprise: { maxRequests: 6000, windowMs: 60_000 },
};

interface Bucket {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private tiers = new Map<string, AccessTier>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  registerKey(key: string, tier: AccessTier): void {
    this.tiers.set(key, tier);
  }

  tierOf(key: string): AccessTier {
    return this.tiers.get(key) ?? "free";
  }

  /** Consume one request budget. Unknown keys are treated as `free`. */
  consume(key: string): { allowed: boolean; remaining: number; resetAfterMs: number } {
    const tier = this.tierOf(key);
    const { maxRequests, windowMs } = TIER_LIMITS[tier];
    const t = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || t - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: t };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAfterMs: bucket.windowStart + windowMs - t };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: maxRequests - bucket.count,
      resetAfterMs: bucket.windowStart + windowMs - t,
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
