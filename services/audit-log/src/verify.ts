/**
 * Audit Log Service — Chain Verifier
 *
 * Standalone tool that walks the entire audit log from genesis and verifies:
 *   1. Each record's `prevHash` matches the previous record's `recordHash`
 *   2. Each record's `recordHash` matches the recomputed hash of its contents
 *
 * Reports the first broken link found, along with the offending sequence number.
 *
 * Usage:
 *   ts-node src/verify.ts [--db path/to/audit.db]
 *
 * Exit codes:
 *   0 — chain intact
 *   1 — tampering detected
 *   2 — empty log (no records to verify)
 *
 * Issue #768
 */

import { AuditStore } from "./store";
import { GENESIS_HASH, computeRecordHash, AuditRecord } from "./types";
import pino from "pino";

const logger = pino({ name: "audit-log:verifier" });

export interface VerifyResult {
  intact: boolean;
  recordsChecked: number;
  firstBrokenSequence?: number;
  reason?: string;
}

export function verifyChain(records: AuditRecord[]): VerifyResult {
  if (records.length === 0) {
    return { intact: true, recordsChecked: 0 };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (const record of records) {
    // Check 1: prevHash linkage
    if (record.prevHash !== expectedPrevHash) {
      logger.error(
        {
          sequence: record.sequence,
          expected: expectedPrevHash,
          actual: record.prevHash,
        },
        "Chain broken: prevHash mismatch"
      );
      return {
        intact: false,
        recordsChecked: record.sequence - 1,
        firstBrokenSequence: record.sequence,
        reason: `prevHash mismatch at sequence ${record.sequence}`,
      };
    }

    // Check 2: recordHash integrity
    const { recordHash, ...partial } = record;
    const recomputed = computeRecordHash(partial);
    if (recomputed !== recordHash) {
      logger.error(
        {
          sequence: record.sequence,
          stored: recordHash,
          recomputed,
        },
        "Chain broken: recordHash mismatch (record contents tampered)"
      );
      return {
        intact: false,
        recordsChecked: record.sequence - 1,
        firstBrokenSequence: record.sequence,
        reason: `recordHash mismatch at sequence ${record.sequence} — contents tampered`,
      };
    }

    expectedPrevHash = record.recordHash;
  }

  logger.info({ recordsChecked: records.length }, "Audit chain verified — intact");
  return { intact: true, recordsChecked: records.length };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf("--db");
  const dbPath = dbIdx !== -1 ? args[dbIdx + 1] : "./audit.db";

  if (!dbPath) {
    console.error("Usage: verify.ts --db <path>");
    process.exit(2);
  }

  const store = new AuditStore(dbPath);
  const records = store.getAll();
  store.close();

  if (records.length === 0) {
    console.log("Audit log is empty — nothing to verify.");
    process.exit(2);
  }

  const result = verifyChain(records);
  if (result.intact) {
    console.log(`✅  Audit chain intact — ${result.recordsChecked} records verified.`);
    process.exit(0);
  } else {
    console.error(`❌  Tampering detected at sequence ${result.firstBrokenSequence}: ${result.reason}`);
    process.exit(1);
  }
}
