/**
 * Tests for cross-contract audit trail verification
 *
 * Coverage targets:
 *   - Detection of on-chain event missing from off-chain log
 *   - Detection of off-chain record missing from on-chain events
 *   - Handling of benign timing skew within tolerance
 *   - Correct handling of actions with no expected counterpart
 *   - Actor hash correspondence validation
 *   - Timing skew exceeding tolerance threshold
 */

import { crossVerify, OnChainAuditEvent, generateReport, MatchResult } from "../src/cross-verify";
import { AuditRecord, GENESIS_HASH, computeRecordHash } from "../src/types";
import * as crypto from "crypto";

describe("Cross-Verification Tool", () => {
  const SKEW_TOLERANCE_MS = 60_000; // 60 seconds

  function hashActor(actor: string): string {
    return crypto.createHash("sha256").update(actor, "utf8").digest("hex");
  }

  function makeOnChainEvent(partial: Partial<OnChainAuditEvent>): OnChainAuditEvent {
    return {
      ledger: 1000,
      txHash: "0xabc",
      contractId: "CCONTRACT001",
      sequence: 1,
      actor: "GACTOR001",
      action: "Pause",
      source: "AccessControl",
      timestamp: Date.now(),
      ...partial,
    };
  }

  function makeOffChainRecord(partial: Partial<AuditRecord>): AuditRecord {
    const base: Omit<AuditRecord, "recordHash"> = {
      sequence: 1,
      timestamp: Date.now(),
      service: "admin-relay",
      action: "admin.relay.transaction.confirmed",
      actorHash: hashActor("GACTOR001"),
      metadata: {},
      prevHash: GENESIS_HASH,
      ...partial,
    };
    return {
      ...base,
      recordHash: computeRecordHash(base),
    };
  }

  describe("Perfect Match", () => {
    it("should match on-chain and off-chain records with identical timestamps", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({
          sequence: 1,
          actor,
          action: "Pause",
          timestamp,
        }),
      ];

      const offChain = [
        makeOffChainRecord({
          sequence: 1,
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp,
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(true);
      expect(result.matched).toBe(1);
      expect(result.timingSkew).toBe(0);
      expect(result.onChainMissing).toBe(0);
      expect(result.offChainMissing).toBe(0);
      expect(result.mismatches).toHaveLength(0);
    });
  });

  describe("Timing Skew Handling", () => {
    it("should accept timing skew within tolerance", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({
          actor,
          action: "Pause",
          timestamp,
        }),
      ];

      const offChain = [
        makeOffChainRecord({
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp: timestamp + 30_000, // 30s skew, within 60s tolerance
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(true);
      expect(result.matched).toBe(1);
      expect(result.mismatches).toHaveLength(0);
    });

    it("should flag timing skew exceeding tolerance as a warning", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({
          actor,
          action: "Pause",
          timestamp,
        }),
      ];

      const offChain = [
        makeOffChainRecord({
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp: timestamp + 120_000, // 120s skew, exceeds 60s tolerance
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(true); // Skew doesn't break consistency, just noted
      expect(result.matched).toBe(0);
      expect(result.timingSkew).toBe(1);
      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0].status).toBe("timing-skew");
      expect(result.mismatches[0].skewMs).toBe(120_000);
    });
  });

  describe("Missing Event Detection", () => {
    it("should detect on-chain event missing from off-chain log", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({
          sequence: 1,
          actor,
          action: "Pause",
          timestamp,
        }),
        makeOnChainEvent({
          sequence: 2,
          actor,
          action: "GrantRole",
          timestamp: timestamp + 10_000,
        }),
      ];

      const offChain = [
        makeOffChainRecord({
          sequence: 1,
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp,
        }),
        // Missing second event!
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(false);
      expect(result.matched).toBe(1);
      expect(result.offChainMissing).toBe(1);
      expect(result.mismatches.length).toBeGreaterThanOrEqual(1);
      
      const missing = result.mismatches.find((m) => m.status === "off-chain-missing");
      expect(missing).toBeDefined();
      expect(missing!.onChainEvent!.action).toBe("GrantRole");
    });

    it("should detect off-chain record missing from on-chain events", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({
          sequence: 1,
          actor,
          action: "Pause",
          timestamp,
        }),
        // Missing second event!
      ];

      const offChain = [
        makeOffChainRecord({
          sequence: 1,
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp,
        }),
        makeOffChainRecord({
          sequence: 2,
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp: timestamp + 10_000,
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(false);
      expect(result.matched).toBe(1);
      expect(result.onChainMissing).toBe(1);
      expect(result.mismatches.length).toBeGreaterThanOrEqual(1);

      const missing = result.mismatches.find((m) => m.status === "on-chain-missing");
      expect(missing).toBeDefined();
      expect(missing!.offChainRecord!.sequence).toBe(2);
    });
  });

  describe("Action Correspondence", () => {
    it("should accept on-chain actions with no expected off-chain counterpart", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({
          actor,
          action: "CorrectMetadataHash", // Direct contract call, no relay
          source: "InvoiceNft",
          timestamp,
        }),
      ];

      const offChain: AuditRecord[] = [];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(true);
      expect(result.matched).toBe(1);
      expect(result.offChainMissing).toBe(0);
    });

    it("should flag action mismatch when off-chain action doesn't correspond", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({
          actor,
          action: "Pause",
          timestamp,
        }),
      ];

      const offChain = [
        makeOffChainRecord({
          actorHash: hashActor(actor),
          action: "kyb.submission.approved", // Wrong action type
          timestamp,
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(false);
      expect(result.matched).toBe(0);
      expect(result.mismatches.length).toBeGreaterThan(0);
    });
  });

  describe("Actor Verification", () => {
    it("should flag actor hash mismatch", () => {
      const timestamp = 1633046400000;

      const onChain = [
        makeOnChainEvent({
          actor: "GACTOR001",
          action: "Pause",
          timestamp,
        }),
      ];

      const offChain = [
        makeOffChainRecord({
          actorHash: hashActor("GACTOR002"), // Different actor
          action: "admin.relay.transaction.confirmed",
          timestamp,
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(false);
      expect(result.matched).toBe(0);
    });
  });

  describe("Multiple Events", () => {
    it("should correctly verify multiple events with mixed outcomes", () => {
      const timestamp = 1633046400000;
      const actor1 = "GACTOR001";
      const actor2 = "GACTOR002";

      const onChain = [
        makeOnChainEvent({
          sequence: 1,
          actor: actor1,
          action: "Pause",
          timestamp,
        }),
        makeOnChainEvent({
          sequence: 2,
          actor: actor2,
          action: "SetFeeBps",
          timestamp: timestamp + 10_000,
        }),
        makeOnChainEvent({
          sequence: 3,
          actor: actor1,
          action: "GrantRole",
          timestamp: timestamp + 20_000,
        }),
      ];

      const offChain = [
        makeOffChainRecord({
          sequence: 1,
          actorHash: hashActor(actor1),
          action: "admin.relay.transaction.confirmed",
          timestamp,
        }),
        makeOffChainRecord({
          sequence: 2,
          actorHash: hashActor(actor2),
          action: "admin.relay.transaction.confirmed",
          timestamp: timestamp + 10_000,
        }),
        // Missing third event!
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(false);
      expect(result.matched).toBe(2);
      expect(result.offChainMissing).toBe(1);
    });
  });

  describe("Report Generation", () => {
    it("should generate consistent report for matching trails", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [makeOnChainEvent({ actor, timestamp })];
      const offChain = [
        makeOffChainRecord({
          actorHash: hashActor(actor),
          timestamp,
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);
      const report = generateReport(result);

      expect(report).toContain("✅ CONSISTENT");
      expect(report).toContain("Matched:                     1");
      expect(report).toContain("On-chain missing:            0");
      expect(report).toContain("Off-chain missing:           0");
    });

    it("should generate divergence report with detailed mismatches", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      const onChain = [
        makeOnChainEvent({ actor, action: "Pause", timestamp }),
        makeOnChainEvent({ actor, action: "GrantRole", timestamp: timestamp + 10_000 }),
      ];
      const offChain = [
        makeOffChainRecord({
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp,
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);
      const report = generateReport(result);

      expect(report).toContain("❌ DIVERGENCE DETECTED");
      expect(report).toContain("Off-chain missing:           1");
      expect(report).toContain("Detailed Mismatches");
      expect(report).toContain("GrantRole");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty trails", () => {
      const result = crossVerify([], [], SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(true);
      expect(result.matched).toBe(0);
      expect(result.totalOnChainEvents).toBe(0);
      expect(result.totalOffChainRecords).toBe(0);
    });

    it("should handle only on-chain events", () => {
      const onChain = [makeOnChainEvent({ action: "CorrectMetadataHash" })];
      const offChain: AuditRecord[] = [];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(true);
      expect(result.matched).toBe(1); // Direct call, no off-chain expected
    });

    it("should handle only off-chain records (suspicious)", () => {
      const onChain: OnChainAuditEvent[] = [];
      const offChain = [
        makeOffChainRecord({
          action: "admin.relay.transaction.confirmed",
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      expect(result.consistent).toBe(false);
      expect(result.onChainMissing).toBe(1);
    });

    it("should handle events out of chronological order", () => {
      const timestamp = 1633046400000;
      const actor = "GACTOR001";

      // On-chain events not in order
      const onChain = [
        makeOnChainEvent({ actor, action: "GrantRole", timestamp: timestamp + 10_000 }),
        makeOnChainEvent({ actor, action: "Pause", timestamp }),
      ];

      // Off-chain records not in order
      const offChain = [
        makeOffChainRecord({
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp: timestamp + 10_000,
        }),
        makeOffChainRecord({
          actorHash: hashActor(actor),
          action: "admin.relay.transaction.confirmed",
          timestamp,
        }),
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      // Should still match after internal sorting
      expect(result.consistent).toBe(true);
      expect(result.matched).toBe(2);
    });
  });

  describe("Coverage - 90% Target", () => {
    it("should cover all status types", () => {
      const timestamp = 1633046400000;
      const actor1 = "GACTOR001";
      const actor2 = "GACTOR002";

      const onChain = [
        makeOnChainEvent({ actor: actor1, action: "Pause", timestamp }), // matched
        makeOnChainEvent({ actor: actor1, action: "GrantRole", timestamp: timestamp + 200_000 }), // timing-skew
        makeOnChainEvent({ actor: actor2, action: "SetFeeBps", timestamp: timestamp + 300_000 }), // off-chain-missing
        makeOnChainEvent({ actor: actor1, action: "CorrectMetadataHash", timestamp: timestamp + 400_000 }), // no counterpart
      ];

      const offChain = [
        makeOffChainRecord({ actorHash: hashActor(actor1), timestamp }), // matched
        makeOffChainRecord({ actorHash: hashActor(actor1), timestamp: timestamp + 100_000 }), // timing-skew
        makeOffChainRecord({ actorHash: hashActor(actor2), timestamp: timestamp + 500_000 }), // on-chain-missing
      ];

      const result = crossVerify(onChain, offChain, SKEW_TOLERANCE_MS);

      // Verify all status types are present
      const statuses = new Set(result.mismatches.map((m) => m.status));
      expect(statuses.has("timing-skew")).toBe(true);
      expect(statuses.has("off-chain-missing")).toBe(true);
      expect(statuses.has("on-chain-missing")).toBe(true);
    });
  });
});
