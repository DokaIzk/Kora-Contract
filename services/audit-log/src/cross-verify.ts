/**
 * Cross-Contract Audit Verification Tool
 *
 * Independently verifies consistency between two parallel audit trails:
 *   1. On-chain events (ADM_AUDIT topic from Soroban contracts)
 *   2. Off-chain hash-chained audit log (this service's SQLite store)
 *
 * For a given time range, walks both trails and reports:
 *   - Actions present in on-chain but missing from off-chain
 *   - Actions present in off-chain but missing/mismatched in on-chain
 *   - Timing skew (benign if within tolerance threshold)
 *   - True divergence (action present in one trail but not the other)
 *
 * Usage:
 *   ts-node src/cross-verify.ts \
 *     --db ./audit.db \
 *     --rpc https://soroban-testnet.stellar.org \
 *     --start-timestamp 1633046400000 \
 *     --end-timestamp 1633132800000 \
 *     --skew-tolerance-ms 60000
 *
 * Exit codes:
 *   0 — trails consistent
 *   1 — divergence detected (detailed report written to stderr)
 *   2 — configuration error
 *
 * Issue: Cross-contract audit trail verification for Wave security deliverables
 */

import { AuditStore } from "./store";
import { AuditRecord } from "./types";
import pino from "pino";
import * as crypto from "crypto";

const logger = pino({ name: "audit-log:cross-verifier" });

// ============================================================================
// Types
// ============================================================================

/**
 * On-chain event schema for ADM_AUDIT (from contracts/shared/src/events.rs)
 * Topic: "ADM_AUDIT"
 * Payload tuple: (sequence: u64, actor: Address, action: String, source: AuditSource, timestamp: u64)
 */
export interface OnChainAuditEvent {
  /** Ledger sequence where event was emitted */
  ledger: number;
  /** Transaction hash containing the event */
  txHash: string;
  /** Contract address that emitted the event */
  contractId: string;
  /** Monotonic sequence number within this contract's audit log */
  sequence: number;
  /** Stellar address that invoked the admin action */
  actor: string;
  /** Admin action type (e.g., "Pause", "GrantRole", "SetFeeBps") */
  action: string;
  /** Contract source (e.g., "AccessControl", "Treasury", "InvoiceNft") */
  source: string;
  /** Timestamp from env.ledger().timestamp() */
  timestamp: number;
}

/**
 * Correspondence mapping between on-chain AdminActionType and off-chain AuditAction.
 * This defines the semantic equivalence for cross-verification.
 */
const ACTION_CORRESPONDENCE: Record<string, string[]> = {
  // AccessControl on-chain → off-chain admin-relay equivalents
  Pause: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  Unpause: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  GrantRole: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  RevokeRole: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  TransferAdmin: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  RotateAdmin: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],

  // Treasury on-chain → off-chain admin-relay equivalents
  SetFeeBps: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  WhitelistToken: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  Withdraw: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  EmergencyWithdraw: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],

  // RiskRegistry on-chain → off-chain debtor verification equivalents
  AddVerifier: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  RemoveVerifier: ["admin.relay.transaction.submitted", "admin.relay.transaction.confirmed"],
  RecordDefault: ["debtor.verification.completed"],

  // InvoiceNft on-chain → potentially no off-chain equivalent (direct contract call)
  // These are acceptable mismatches if called directly without relay
  CorrectMetadataHash: [],
  UpdateMetadataCid: [],
  InvoiceNftSetRiskRegistry: [],
};

/**
 * Result of cross-verification for a single action pair.
 */
export interface MatchResult {
  onChainEvent?: OnChainAuditEvent;
  offChainRecord?: AuditRecord;
  status: "matched" | "timing-skew" | "on-chain-missing" | "off-chain-missing" | "mismatch";
  skewMs?: number;
  reason?: string;
}

export interface CrossVerifyResult {
  consistent: boolean;
  totalOnChainEvents: number;
  totalOffChainRecords: number;
  matched: number;
  timingSkew: number;
  onChainMissing: number;
  offChainMissing: number;
  mismatches: MatchResult[];
}

// ============================================================================
// On-Chain Event Fetcher (Soroban RPC)
// ============================================================================

/**
 * Fetches ADM_AUDIT events from Soroban RPC for a given time range.
 * 
 * NOTE: This is a simplified implementation. Production use should leverage
 * a dedicated indexer (Horizon, Mercury, or custom) for efficient event querying.
 * 
 * For this verification tool, we assume:
 *   1. Events are fetched via Soroban RPC `getEvents` with topic filter "ADM_AUDIT"
 *   2. Timestamp filtering is done client-side after fetch
 *   3. Contract addresses for all protocol contracts are known
 */
export async function fetchOnChainEvents(
  rpcUrl: string,
  contractIds: string[],
  startTimestamp: number,
  endTimestamp: number
): Promise<OnChainAuditEvent[]> {
  logger.info(
    {
      rpcUrl,
      contracts: contractIds.length,
      startTimestamp,
      endTimestamp,
    },
    "Fetching on-chain ADM_AUDIT events"
  );

  // TODO: Implement actual Soroban RPC getEvents call
  // This would typically use stellar-sdk or direct JSON-RPC:
  //
  // const response = await fetch(rpcUrl, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     jsonrpc: "2.0",
  //     id: 1,
  //     method: "getEvents",
  //     params: {
  //       startLedger: ledgerForTimestamp(startTimestamp),
  //       filters: [{ type: "contract", contractIds, topics: [["ADM_AUDIT"]] }]
  //     }
  //   })
  // });
  //
  // Then decode XDR payloads into OnChainAuditEvent structs

  // For now, return mock data for testing
  logger.warn("Using mock on-chain events — replace with actual RPC integration");
  return [];
}

// ============================================================================
// Correspondence Matcher
// ============================================================================

/**
 * Determines if an on-chain action corresponds to an off-chain record.
 * Accounts for timing skew within tolerance and semantic equivalence.
 */
function matchEvents(
  onChain: OnChainAuditEvent,
  offChain: AuditRecord,
  skewToleranceMs: number
): MatchResult {
  // 1. Check actor correspondence
  const actorHash = crypto.createHash("sha256").update(onChain.actor, "utf8").digest("hex");
  if (actorHash !== offChain.actorHash) {
    return {
      onChainEvent: onChain,
      offChainRecord: offChain,
      status: "mismatch",
      reason: `Actor mismatch: on-chain actor ${onChain.actor} (hash ${actorHash}) != off-chain hash ${offChain.actorHash}`,
    };
  }

  // 2. Check action correspondence
  const expectedOffChainActions = ACTION_CORRESPONDENCE[onChain.action] || [];
  if (expectedOffChainActions.length === 0) {
    // On-chain action with no expected off-chain counterpart (e.g., direct contract calls)
    // This is acceptable — mark as matched with note
    return {
      onChainEvent: onChain,
      status: "matched",
      reason: `On-chain action ${onChain.action} has no expected off-chain counterpart (direct call acceptable)`,
    };
  }

  if (!expectedOffChainActions.includes(offChain.action)) {
    return {
      onChainEvent: onChain,
      offChainRecord: offChain,
      status: "mismatch",
      reason: `Action mismatch: on-chain ${onChain.action} does not correspond to off-chain ${offChain.action}`,
    };
  }

  // 3. Check timestamp skew
  const skewMs = Math.abs(onChain.timestamp - offChain.timestamp);
  if (skewMs > skewToleranceMs) {
    return {
      onChainEvent: onChain,
      offChainRecord: offChain,
      status: "timing-skew",
      skewMs,
      reason: `Timing skew ${skewMs}ms exceeds tolerance ${skewToleranceMs}ms`,
    };
  }

  return {
    onChainEvent: onChain,
    offChainRecord: offChain,
    status: "matched",
    skewMs,
  };
}

/**
 * Cross-verifies on-chain events against off-chain audit records.
 * 
 * Strategy:
 *   1. Sort both trails by timestamp
 *   2. Walk both in parallel with sliding window for skew tolerance
 *   3. For each on-chain event, search for corresponding off-chain record within skew window
 *   4. Report matched, skewed, and missing entries
 */
export function crossVerify(
  onChainEvents: OnChainAuditEvent[],
  offChainRecords: AuditRecord[],
  skewToleranceMs: number
): CrossVerifyResult {
  logger.info(
    {
      onChainEvents: onChainEvents.length,
      offChainRecords: offChainRecords.length,
      skewToleranceMs,
    },
    "Starting cross-verification"
  );

  const result: CrossVerifyResult = {
    consistent: true,
    totalOnChainEvents: onChainEvents.length,
    totalOffChainRecords: offChainRecords.length,
    matched: 0,
    timingSkew: 0,
    onChainMissing: 0,
    offChainMissing: 0,
    mismatches: [],
  };

  // Sort both trails by timestamp
  const sortedOnChain = [...onChainEvents].sort((a, b) => a.timestamp - b.timestamp);
  const sortedOffChain = [...offChainRecords].sort((a, b) => a.timestamp - b.timestamp);

  const matchedOffChainIndices = new Set<number>();

  // For each on-chain event, find corresponding off-chain record
  for (const onChainEvent of sortedOnChain) {
    let bestMatch: MatchResult | null = null;
    let bestMatchIndex = -1;

    // Search for off-chain records within skew tolerance window
    for (let i = 0; i < sortedOffChain.length; i++) {
      if (matchedOffChainIndices.has(i)) continue;

      const offChainRecord = sortedOffChain[i];
      const timeDiff = Math.abs(onChainEvent.timestamp - offChainRecord.timestamp);

      // Skip if outside skew tolerance window
      if (timeDiff > skewToleranceMs) {
        // If off-chain is way ahead, stop searching
        if (offChainRecord.timestamp > onChainEvent.timestamp + skewToleranceMs) {
          break;
        }
        continue;
      }

      const matchAttempt = matchEvents(onChainEvent, offChainRecord, skewToleranceMs);
      if (matchAttempt.status === "matched" || matchAttempt.status === "timing-skew") {
        bestMatch = matchAttempt;
        bestMatchIndex = i;
        break;
      }
    }

    if (bestMatch) {
      if (bestMatch.status === "matched") {
        result.matched++;
      } else if (bestMatch.status === "timing-skew") {
        result.timingSkew++;
        result.mismatches.push(bestMatch);
        logger.warn({ match: bestMatch }, "Timing skew detected");
      }
      if (bestMatchIndex >= 0) {
        matchedOffChainIndices.add(bestMatchIndex);
      }
    } else {
      // No corresponding off-chain record found
      result.offChainMissing++;
      result.consistent = false;
      const mismatch: MatchResult = {
        onChainEvent,
        status: "off-chain-missing",
        reason: `On-chain event at ledger ${onChainEvent.ledger} (action: ${onChainEvent.action}) has no corresponding off-chain record`,
      };
      result.mismatches.push(mismatch);
      logger.error({ mismatch }, "Off-chain record missing for on-chain event");
    }
  }

  // Check for off-chain records without on-chain counterparts
  for (let i = 0; i < sortedOffChain.length; i++) {
    if (matchedOffChainIndices.has(i)) continue;

    const offChainRecord = sortedOffChain[i];
    // Only flag as missing if the action SHOULD have an on-chain counterpart
    if (offChainRecord.service === "admin-relay") {
      result.onChainMissing++;
      result.consistent = false;
      const mismatch: MatchResult = {
        offChainRecord,
        status: "on-chain-missing",
        reason: `Off-chain record (seq ${offChainRecord.sequence}, action: ${offChainRecord.action}) expected on-chain event but none found`,
      };
      result.mismatches.push(mismatch);
      logger.error({ mismatch }, "On-chain event missing for off-chain record");
    }
  }

  logger.info({ result }, "Cross-verification complete");
  return result;
}

// ============================================================================
// Report Generator
// ============================================================================

export function generateReport(result: CrossVerifyResult): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  Cross-Contract Audit Trail Verification Report");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Status: ${result.consistent ? "✅ CONSISTENT" : "❌ DIVERGENCE DETECTED"}`);
  lines.push("");
  lines.push("Summary:");
  lines.push(`  Total on-chain events:       ${result.totalOnChainEvents}`);
  lines.push(`  Total off-chain records:     ${result.totalOffChainRecords}`);
  lines.push(`  Matched:                     ${result.matched}`);
  lines.push(`  Timing skew (within tolerance): ${result.timingSkew}`);
  lines.push(`  On-chain missing:            ${result.onChainMissing}`);
  lines.push(`  Off-chain missing:           ${result.offChainMissing}`);
  lines.push("");

  if (result.mismatches.length > 0) {
    lines.push("Detailed Mismatches:");
    lines.push("───────────────────────────────────────────────────────────────");
    for (const [idx, mismatch] of result.mismatches.entries()) {
      lines.push(`[${idx + 1}] ${mismatch.status.toUpperCase()}`);
      if (mismatch.onChainEvent) {
        lines.push(`    On-chain: ledger=${mismatch.onChainEvent.ledger} action=${mismatch.onChainEvent.action} actor=${mismatch.onChainEvent.actor} ts=${mismatch.onChainEvent.timestamp}`);
      }
      if (mismatch.offChainRecord) {
        lines.push(`    Off-chain: seq=${mismatch.offChainRecord.sequence} action=${mismatch.offChainRecord.action} ts=${mismatch.offChainRecord.timestamp}`);
      }
      lines.push(`    Reason: ${mismatch.reason}`);
      if (mismatch.skewMs !== undefined) {
        lines.push(`    Skew: ${mismatch.skewMs}ms`);
      }
      lines.push("");
    }
  }

  lines.push("═══════════════════════════════════════════════════════════════");
  return lines.join("\n");
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const getArg = (name: string): string | undefined => {
      const idx = args.indexOf(name);
      return idx !== -1 ? args[idx + 1] : undefined;
    };

    const dbPath = getArg("--db") || "./audit.db";
    const rpcUrl = getArg("--rpc") || "https://soroban-testnet.stellar.org";
    const startTimestamp = parseInt(getArg("--start-timestamp") || "0", 10);
    const endTimestamp = parseInt(getArg("--end-timestamp") || `${Date.now()}`, 10);
    const skewToleranceMs = parseInt(getArg("--skew-tolerance-ms") || "60000", 10);
    const contractsArg = getArg("--contracts");

    if (!contractsArg) {
      console.error("Usage: cross-verify.ts --db <path> --rpc <url> --contracts <id1,id2,...> [--start-timestamp <ms>] [--end-timestamp <ms>] [--skew-tolerance-ms <ms>]");
      process.exit(2);
    }

    const contractIds = contractsArg.split(",").map((s) => s.trim());

    logger.info(
      {
        dbPath,
        rpcUrl,
        contractIds,
        startTimestamp,
        endTimestamp,
        skewToleranceMs,
      },
      "Starting cross-verification"
    );

    // 1. Load off-chain audit records
    const store = new AuditStore(dbPath);
    const allOffChainRecords = store.getAll();
    const offChainRecords = allOffChainRecords.filter(
      (r) => r.timestamp >= startTimestamp && r.timestamp <= endTimestamp
    );
    store.close();

    logger.info({ total: offChainRecords.length }, "Loaded off-chain audit records");

    // 2. Fetch on-chain events
    const onChainEvents = await fetchOnChainEvents(rpcUrl, contractIds, startTimestamp, endTimestamp);
    logger.info({ total: onChainEvents.length }, "Fetched on-chain audit events");

    // 3. Cross-verify
    const result = crossVerify(onChainEvents, offChainRecords, skewToleranceMs);

    // 4. Generate and print report
    const report = generateReport(result);
    console.log(report);

    // 5. Exit with appropriate code
    if (result.consistent) {
      logger.info("Cross-verification passed — trails are consistent");
      process.exit(0);
    } else {
      logger.error("Cross-verification failed — divergence detected");
      process.exit(1);
    }
  })().catch((err) => {
    logger.error({ err }, "Cross-verification failed with error");
    console.error(err);
    process.exit(2);
  });
}
