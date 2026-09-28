/**
 * Feature Flag Service — Main Service
 *
 * Orchestrates flag evaluation, kill-switch propagation, and audit logging.
 *
 * Usage:
 *   const svc = new FeatureFlagService(store, auditClient);
 *   const snapshot = svc.resolveForUser("user-id-123");
 *   svc.onKillSwitch((event) => pushToClient(event));
 */

import * as crypto from "crypto";
import pino from "pino";
import { FlagStore } from "./store";
import { evaluateFlag, evaluateAll } from "./evaluate";
import {
  FeatureFlag,
  FeatureName,
  FlagSnapshot,
  FlagChangeEvent,
  FlagAuditEntry,
} from "./types";

const logger = pino({ name: "feature-flags:service" });

/** Minimal interface the service needs from the audit log client. */
export interface AuditEmitter {
  emit(
    service: string,
    action: string,
    actorRef: string,
    metadata: Record<string, unknown>
  ): Promise<void>;
}

export type KillSwitchListener = (event: FlagChangeEvent) => void;

export class FeatureFlagService {
  private killSwitchListeners: KillSwitchListener[] = [];

  constructor(
    private readonly store: FlagStore,
    private readonly audit: AuditEmitter | null = null
  ) {
    // Forward store changes to kill-switch listeners
    this.store.onFlagChange((flag) => this.handleFlagChange(flag));
  }

  // ── Session-start resolution ──────────────────────────────────────────────

  /**
   * Resolve all flags for a user at session start.
   * Returns a snapshot of flag values — no targeting details exposed.
   *
   * @param userId - Raw user identifier (hashed internally)
   */
  resolveForUser(userId: string): FlagSnapshot {
    const flags = this.store.getAll();
    return evaluateAll(flags, userId) as FlagSnapshot;
  }

  /**
   * Resolve a single flag for a user.
   * Use this for mid-request checks.
   */
  isEnabled(flagName: FeatureName, userId: string): boolean {
    const flag = this.store.getByName(flagName);
    if (!flag) return false; // unknown flag → off
    return evaluateFlag(flag, userId).value;
  }

  // ── Kill-switch ───────────────────────────────────────────────────────────

  /**
   * Instantly disable a flag for all users.
   * The change propagates to connected SSE clients via onKillSwitch listeners
   * without requiring a redeploy.
   *
   * @param flagName  - Flag to disable
   * @param actorRef  - Who triggered this (e.g., "admin@kora.finance")
   */
  async disable(flagName: FeatureName, actorRef: string): Promise<void> {
    const before = this.store.getByName(flagName);
    this.store.setEnabled(flagName, false, actorRef);
    await this.recordAudit(flagName, "disabled", before?.enabled ?? null, false, actorRef);
    logger.warn({ flag: flagName, actor: hashRef(actorRef) }, "Feature flag disabled (kill-switch)");
  }

  /**
   * Enable a flag (re-enables after kill-switch).
   */
  async enable(flagName: FeatureName, actorRef: string): Promise<void> {
    const before = this.store.getByName(flagName);
    this.store.setEnabled(flagName, true, actorRef);
    await this.recordAudit(flagName, "enabled", before?.enabled ?? null, true, actorRef);
    logger.info({ flag: flagName, actor: hashRef(actorRef) }, "Feature flag enabled");
  }

  /**
   * Register a listener that receives kill-switch events.
   * The API layer uses this to push SSE updates to connected clients.
   */
  onKillSwitch(listener: KillSwitchListener): () => void {
    this.killSwitchListeners.push(listener);
    // Return a cleanup function
    return () => {
      this.killSwitchListeners = this.killSwitchListeners.filter((l) => l !== listener);
    };
  }

  // ── Flag management ───────────────────────────────────────────────────────

  async upsertFlag(
    flag: Omit<FeatureFlag, "createdAt" | "updatedAt">,
    actorRef: string
  ): Promise<FeatureFlag> {
    const before = this.store.getByName(flag.name);
    const result = this.store.upsert({ ...flag, updatedBy: hashRef(actorRef) });
    const action = before ? "rules-updated" : "created";
    await this.recordAudit(flag.name, action, before?.enabled ?? null, result.enabled, actorRef, result);
    return result;
  }

  getFlag(name: FeatureName): FeatureFlag | null {
    return this.store.getByName(name);
  }

  getAllFlags(): FeatureFlag[] {
    return this.store.getAll();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private handleFlagChange(flag: FeatureFlag): void {
    const event: FlagChangeEvent = {
      type: "flag-changed",
      name: flag.name,
      value: flag.enabled,
      changedAt: flag.updatedAt,
    };

    for (const listener of this.killSwitchListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err, flag: flag.name }, "Kill-switch listener error");
      }
    }
  }

  private async recordAudit(
    flagName: FeatureName,
    action: FlagAuditEntry["action"],
    previousValue: boolean | null,
    newValue: boolean | null,
    actorRef: string,
    flagSnapshot?: Partial<FeatureFlag>
  ): Promise<void> {
    if (!this.audit) return;

    try {
      await this.audit.emit(
        "feature-flags",
        `feature-flag.${action}`,
        actorRef,
        {
          flagName,
          action,
          previousValue,
          newValue,
          flagSnapshot: flagSnapshot
            ? { name: flagSnapshot.name, enabled: flagSnapshot.enabled }
            : undefined,
        }
      );
    } catch (err) {
      // Audit logging failure must NOT block flag operations
      logger.error({ err, flagName, action }, "Audit log emission failed (non-fatal)");
    }
  }
}

function hashRef(ref: string): string {
  return crypto.createHash("sha256").update(ref, "utf8").digest("hex").slice(0, 16);
}
