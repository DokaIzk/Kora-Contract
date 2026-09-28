/**
 * Feature Flag Service — Evaluation Engine
 *
 * Server-side deterministic flag evaluation. This module contains no I/O —
 * it takes a flag definition and a user context and returns a boolean result.
 *
 * Key properties:
 * - Deterministic: same user + same flag always resolves the same way
 * - Side-effect free: evaluation does not modify state
 * - Cannot be bypassed from the client side (evaluation is server-only)
 */

import * as crypto from "crypto";
import {
  FeatureFlag,
  FlagEvaluation,
  PercentageRule,
  AllowlistRule,
  DenylistRule,
} from "./types";

/**
 * Evaluate a single flag for a given user.
 *
 * @param flag     - The flag definition from the store
 * @param userId   - Raw user identifier (will be hashed internally — not stored)
 * @returns        - Evaluation result with reason for observability
 */
export function evaluateFlag(flag: FeatureFlag, userId: string): FlagEvaluation {
  // Kill-switch: globally disabled — no rules consulted
  if (!flag.enabled) {
    return { name: flag.name, value: false, reason: "kill-switch-off" };
  }

  // Hash userId once to avoid substring-based oracle attacks
  const userHash = hashUser(userId);

  for (const rule of flag.rules) {
    switch (rule.type) {
      case "allowlist": {
        const match = (rule as AllowlistRule).allowedUserHashes.includes(userHash);
        if (match) {
          return { name: flag.name, value: true, reason: "allowlist-match" };
        }
        break;
      }

      case "denylist": {
        const match = (rule as DenylistRule).deniedUserHashes.includes(userHash);
        if (match) {
          return { name: flag.name, value: false, reason: "denylist-match" };
        }
        break;
      }

      case "percentage": {
        const pctRule = rule as PercentageRule;
        const salt = pctRule.salt ?? flag.name;
        const bucket = computeRolloutBucket(userId, flag.name, salt);
        if (bucket < pctRule.rolloutBps) {
          return { name: flag.name, value: true, reason: "percentage-in" };
        } else {
          return { name: flag.name, value: false, reason: "percentage-out" };
        }
      }
    }
  }

  // No rules matched — default to off
  return { name: flag.name, value: false, reason: "no-rules-default-off" };
}

/**
 * Evaluate all flags for a user and return a snapshot suitable for the client.
 * This is called at session start.
 */
export function evaluateAll(
  flags: FeatureFlag[],
  userId: string
): Record<string, boolean> {
  const snapshot: Record<string, boolean> = {};
  for (const flag of flags) {
    snapshot[flag.name] = evaluateFlag(flag, userId).value;
  }
  return snapshot;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Hash a raw user identifier for safe comparison in allow/deny lists.
 * Uses SHA-256 so the raw user ID is never retained in the evaluation path.
 */
export function hashUser(userId: string): string {
  return crypto.createHash("sha256").update(userId, "utf8").digest("hex");
}

/**
 * Compute a deterministic rollout bucket for a (userId, flagName, salt) triple.
 *
 * Returns a number in [0, 9999].
 *
 * The salt ensures different flags don't correlate for the same user
 * (i.e., a user at 10% for flag A is not necessarily at 10% for flag B).
 *
 * Algorithm:
 *   1. Concatenate userId + ":" + flagName + ":" + salt
 *   2. SHA-256 the concatenation
 *   3. Take the first 8 bytes as a big-endian uint64
 *   4. Modulo 10000 gives a uniform bucket in [0, 9999]
 */
export function computeRolloutBucket(
  userId: string,
  flagName: string,
  salt: string
): number {
  const input = `${userId}:${flagName}:${salt}`;
  const hash = crypto.createHash("sha256").update(input, "utf8").digest();
  // Read first 4 bytes as unsigned 32-bit big-endian integer
  const n = hash.readUInt32BE(0);
  return n % 10000;
}
