/**
 * Feature Flag Service — Types
 *
 * Server-evaluated feature flags with percentage rollout, allow-list targeting,
 * and instant kill-switch support. Flags are evaluated server-side so clients
 * cannot bypass them by inspecting local state.
 *
 * Scope: secondary market, fractionalization, insurance pool rollout control.
 */

/** Known feature flag names. Add new flags here before enabling them. */
export type FeatureName =
  | "secondary-market"
  | "fractionalization"
  | "insurance-pool"
  | "multi-asset-pool"
  | "portfolio-diversification-cap"
  | "partial-repayment";

/** Targeting rule type. */
export type TargetingType = "percentage" | "allowlist" | "denylist";

/**
 * Percentage rollout rule.
 * A user is in the rollout if: hash(userId + flagName + salt) % 10000 < rolloutBps
 * This is deterministic per user — the same user always gets the same result.
 */
export interface PercentageRule {
  type: "percentage";
  /** Rollout fraction in basis points: 0 = off, 10000 = 100% on. */
  rolloutBps: number;
  /** Salt prevents different flags from correlating for the same user. Defaults to flagName. */
  salt?: string;
}

/** Explicit allow-list: flag is on for exactly these user IDs. */
export interface AllowlistRule {
  type: "allowlist";
  /** SHA-256 hashes of allowed user identifiers (never store raw IDs). */
  allowedUserHashes: string[];
}

/** Explicit deny-list: flag is off for these users regardless of percentage rollout. */
export interface DenylistRule {
  type: "denylist";
  /** SHA-256 hashes of denied user identifiers. */
  deniedUserHashes: string[];
}

export type TargetingRule = PercentageRule | AllowlistRule | DenylistRule;

/**
 * A feature flag definition stored in the database.
 */
export interface FeatureFlag {
  /** Unique flag name. */
  name: FeatureName;
  /** Human-readable description. */
  description: string;
  /**
   * Kill-switch: when false, the flag is OFF for everyone regardless of rules.
   * This is the instant disable mechanism — no redeploy required.
   */
  enabled: boolean;
  /** Ordered list of targeting rules. Rules are evaluated in order; first match wins. */
  rules: TargetingRule[];
  /** ISO timestamp when the flag was created. */
  createdAt: string;
  /** ISO timestamp of the last modification. */
  updatedAt: string;
  /** Who last modified this flag (for audit trail). */
  updatedBy: string;
}

/**
 * Result of evaluating a flag for a specific user.
 */
export interface FlagEvaluation {
  name: FeatureName;
  /** Whether the flag is active for this user. */
  value: boolean;
  /** Why the flag resolved to this value — for debugging, never surfaced to client. */
  reason:
    | "kill-switch-off"
    | "allowlist-match"
    | "denylist-match"
    | "percentage-in"
    | "percentage-out"
    | "no-rules-default-off";
}

/**
 * Session-start payload sent to the client.
 * Contains resolved flag values only — no targeting rules (prevents bypass).
 */
export type FlagSnapshot = Record<FeatureName, boolean>;

/**
 * Payload pushed to clients via the kill-switch SSE stream when a flag changes.
 */
export interface FlagChangeEvent {
  type: "flag-changed";
  name: FeatureName;
  value: boolean;
  /** ISO timestamp of the change — lets clients debounce stale events. */
  changedAt: string;
}

/**
 * Audit log entry for flag state changes.
 * Uses the audit-log service's AuditAction type indirectly — mapped at call site.
 */
export interface FlagAuditEntry {
  flagName: FeatureName;
  action: "created" | "enabled" | "disabled" | "rules-updated" | "deleted";
  previousValue: boolean | null;
  newValue: boolean | null;
  changedBy: string;
  changedAt: string;
  /** Snapshot of the full flag state after the change. */
  flagSnapshot: Partial<FeatureFlag>;
}
