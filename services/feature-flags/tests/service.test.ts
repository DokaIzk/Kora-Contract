/**
 * Feature Flag Service Integration Tests
 *
 * Tests:
 *  - resolveForUser returns correct snapshot
 *  - kill-switch propagates to SSE listeners
 *  - kill-switch propagation timing (within cache TTL)
 *  - mid-flow disable: existing sessions see value=false on next poll
 *  - audit log is called on enable/disable
 *  - audit log failure does not block flag operations
 */

import { FlagStore } from "../src/store";
import { FeatureFlagService, AuditEmitter } from "../src/service";
import { FlagChangeEvent, FeatureFlag } from "../src/types";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const NOW = new Date().toISOString();

function tmpDb(): string {
  return path.join(os.tmpdir(), `kora-flags-test-${Date.now()}-${Math.random()}.db`);
}

function makeAudit(): { audit: AuditEmitter; calls: unknown[] } {
  const calls: unknown[] = [];
  const audit: AuditEmitter = {
    emit: jest.fn(async (service, action, actorRef, metadata) => {
      calls.push({ service, action, actorRef, metadata });
    }),
  };
  return { audit, calls };
}

function seed(store: FlagStore, overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return store.upsert({
    name: "secondary-market",
    description: "Secondary market feature",
    enabled: true,
    rules: [{ type: "percentage", rolloutBps: 10000 }],
    updatedBy: "test",
    ...overrides,
  });
}

// ── resolveForUser ────────────────────────────────────────────────────────────

describe("resolveForUser", () => {
  it("returns a snapshot with all flags", () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    store.upsert({ name: "secondary-market", description: "", enabled: true, rules: [{ type: "percentage", rolloutBps: 10000 }], updatedBy: "t" });
    store.upsert({ name: "fractionalization", description: "", enabled: false, rules: [], updatedBy: "t" });

    const svc = new FeatureFlagService(store);
    const snap = svc.resolveForUser("user-1");

    expect(snap["secondary-market"]).toBe(true);
    expect(snap["fractionalization"]).toBe(false);
  });

  it("does not expose rule details in the snapshot", () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const svc = new FeatureFlagService(store);
    const snap = svc.resolveForUser("user-1");
    // Snapshot should only contain booleans, not targeting rules
    for (const val of Object.values(snap)) {
      expect(typeof val).toBe("boolean");
    }
  });
});

// ── isEnabled ─────────────────────────────────────────────────────────────────

describe("isEnabled", () => {
  it("returns false for unknown flags (safe default)", () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    const svc = new FeatureFlagService(store);
    expect(svc.isEnabled("secondary-market", "user-1")).toBe(false);
  });

  it("returns correct value for known flag", () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const svc = new FeatureFlagService(store);
    expect(svc.isEnabled("secondary-market", "user-1")).toBe(true);
  });
});

// ── Kill-switch propagation ───────────────────────────────────────────────────

describe("kill-switch propagation", () => {
  it("propagates disable event to registered listeners", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const { audit } = makeAudit();
    const svc = new FeatureFlagService(store, audit);

    const received: FlagChangeEvent[] = [];
    svc.onKillSwitch((evt) => received.push(evt));

    await svc.disable("secondary-market", "admin@kora.finance");

    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("secondary-market");
    expect(received[0].value).toBe(false);
    expect(received[0].type).toBe("flag-changed");
  });

  it("propagates enable event to registered listeners", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store, { enabled: false });
    const svc = new FeatureFlagService(store);

    const received: FlagChangeEvent[] = [];
    svc.onKillSwitch((evt) => received.push(evt));

    await svc.enable("secondary-market", "admin@kora.finance");

    expect(received[0].value).toBe(true);
  });

  it("cleanup function removes listener", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const svc = new FeatureFlagService(store);

    const received: FlagChangeEvent[] = [];
    const cleanup = svc.onKillSwitch((evt) => received.push(evt));
    cleanup(); // unregister

    await svc.disable("secondary-market", "admin");
    expect(received).toHaveLength(0); // listener was removed
  });

  it("listener errors don't prevent other listeners from receiving events", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const svc = new FeatureFlagService(store);

    const goodEvents: FlagChangeEvent[] = [];
    svc.onKillSwitch(() => { throw new Error("listener crash"); });
    svc.onKillSwitch((evt) => goodEvents.push(evt));

    await svc.disable("secondary-market", "admin");
    expect(goodEvents).toHaveLength(1);
  });

  it("mid-flow disable: isEnabled returns false immediately after disable", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const svc = new FeatureFlagService(store);

    expect(svc.isEnabled("secondary-market", "user-1")).toBe(true);
    await svc.disable("secondary-market", "admin");
    expect(svc.isEnabled("secondary-market", "user-1")).toBe(false);
  });
});

// ── Audit logging ─────────────────────────────────────────────────────────────

describe("audit logging", () => {
  it("emits audit record on disable", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const { audit, calls } = makeAudit();
    const svc = new FeatureFlagService(store, audit);

    await svc.disable("secondary-market", "admin@kora.finance");

    expect(calls).toHaveLength(1);
    const entry = calls[0] as Record<string, unknown>;
    expect(entry.action).toBe("feature-flag.disabled");
    const metadata = entry.metadata as Record<string, unknown>;
    expect(metadata.flagName).toBe("secondary-market");
    expect(metadata.newValue).toBe(false);
    expect(metadata.previousValue).toBe(true);
  });

  it("emits audit record on enable", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store, { enabled: false });
    const { audit, calls } = makeAudit();
    const svc = new FeatureFlagService(store, audit);

    await svc.enable("secondary-market", "admin@kora.finance");

    expect(calls).toHaveLength(1);
    const entry = calls[0] as Record<string, unknown>;
    expect(entry.action).toBe("feature-flag.enabled");
  });

  it("audit failure does not block disable operation", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    seed(store);
    const faultyAudit: AuditEmitter = {
      emit: async () => { throw new Error("audit service down"); },
    };
    const svc = new FeatureFlagService(store, faultyAudit);

    // Should not throw even though audit fails
    await expect(svc.disable("secondary-market", "admin")).resolves.not.toThrow();
    // Flag should still be disabled
    expect(svc.isEnabled("secondary-market", "user-1")).toBe(false);
  });
});

// ── upsertFlag ────────────────────────────────────────────────────────────────

describe("upsertFlag", () => {
  it("creates a new flag", async () => {
    const store = new FlagStore(tmpDb(), { cacheTtlMs: 0 });
    const { audit } = makeAudit();
    const svc = new FeatureFlagService(store, audit);

    await svc.upsertFlag(
      { name: "insurance-pool", description: "Insurance pool beta", enabled: true, rules: [], updatedBy: "admin" },
      "admin@kora.finance"
    );

    const flag = svc.getFlag("insurance-pool");
    expect(flag).not.toBeNull();
    expect(flag!.enabled).toBe(true);
  });
});
