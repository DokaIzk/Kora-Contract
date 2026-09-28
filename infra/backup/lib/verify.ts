/**
 * Service-Specific Verification Logic
 *
 * Implements verification for each backed-up service:
 * - audit-log: Full hash-chain verification using the audit-log verifier
 * - keeper: Basic schema + row count validation
 * - reporting: Basic schema + row count validation
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import Database, { Database as DB } from "better-sqlite3";
import { BackupConfig } from "./config";
import { verifySqliteBasic } from "./sqlite";
import pino from "pino";

const logger = pino({ name: "backup:verify" });
const execFile = promisify(cp.execFile);

export interface VerificationResult {
  service: string;
  ok: boolean;
  durationMs: number;
  details: Record<string, unknown>;
  error?: string;
}

/**
 * Verify audit-log database using the hash-chain verifier.
 */
export async function verifyAuditLog(dbPath: string, config: BackupConfig): Promise<VerificationResult> {
  const start = Date.now();

  try {
    // First, basic SQLite check
    const basic = await verifySqliteBasic(dbPath, ["audit_log"]);
    if (!basic.ok) {
      return {
        service: "audit-log",
        ok: false,
        durationMs: Date.now() - start,
        details: { basic },
        error: basic.error,
      };
    }

    // Run the audit-log chain verifier
    const verifyConfig = config.verification.auditLog;
    const verifyPath = path.resolve(__dirname, "..", verifyConfig.verifyArgs[0]);

    // Check if verify script exists (built)
    if (!fs.existsSync(verifyPath)) {
      // Try to find it relative to the repo root
      const altPath = path.resolve(process.cwd(), "services/audit-log/dist/verify.js");
      if (!fs.existsSync(altPath)) {
        throw new Error(`Audit log verifier not found at ${verifyPath} or ${altPath}. Run 'npm run build' in services/audit-log first.`);
      }
    }

    const args = [...verifyConfig.verifyArgs.slice(1), dbPath];
    const { stdout, stderr } = await execFile(verifyConfig.verifyBinary, [verifyPath, ...args], {
      timeout: 60000, // 60 second timeout
    });

    const durationMs = Date.now() - start;

    // Verifier exits 0 on success, 1 on tampering, 2 on empty log
    // We treat empty log as OK for restore verification (fresh DB is valid)
    const intact = stdout.includes("intact") || stdout.includes("empty");

    return {
      service: "audit-log",
      ok: intact,
      durationMs,
      details: {
        basic,
        verifierOutput: stdout.trim(),
        verifierStderr: stderr.trim(),
      },
      error: intact ? undefined : "Hash chain verification failed",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ dbPath, msg }, "Audit log verification error");
    return {
      service: "audit-log",
      ok: false,
      durationMs: Date.now() - start,
      details: {},
      error: msg,
    };
  }
}

/**
 * Verify keeper database (schema + row counts).
 */
export async function verifyKeeper(dbPath: string): Promise<VerificationResult> {
  const start = Date.now();

  try {
    const basic = await verifySqliteBasic(dbPath, ["keeper_jobs"]);
    if (!basic.ok) {
      return {
        service: "keeper",
        ok: false,
        durationMs: Date.now() - start,
        details: { basic },
        error: basic.error,
      };
    }

    // Additional keeper-specific checks
    const db = new Database(dbPath, { readonly: true });
    try {
      const statusCounts = db
        .prepare(`SELECT status, COUNT(*) as cnt FROM keeper_jobs GROUP BY status`)
        .all() as { status: string; cnt: number }[];
      const totalJobs = db.prepare(`SELECT COUNT(*) as cnt FROM keeper_jobs`).get() as { cnt: number };

      return {
        service: "keeper",
        ok: true,
        durationMs: Date.now() - start,
        details: {
          basic,
          statusCounts,
          totalJobs: totalJobs.cnt,
        },
      };
    } finally {
      db.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      service: "keeper",
      ok: false,
      durationMs: Date.now() - start,
      details: {},
      error: msg,
    };
  }
}

/**
 * Verify reporting database (schema + row counts).
 */
export async function verifyReporting(dbPath: string): Promise<VerificationResult> {
  const start = Date.now();

  try {
    const basic = await verifySqliteBasic(dbPath, ["export_jobs"]);
    if (!basic.ok) {
      return {
        service: "reporting",
        ok: false,
        durationMs: Date.now() - start,
        details: { basic },
        error: basic.error,
      };
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const statusCounts = db
        .prepare(`SELECT status, COUNT(*) as cnt FROM export_jobs GROUP BY status`)
        .all() as { status: string; cnt: number }[];
      const totalJobs = db.prepare(`SELECT COUNT(*) as cnt FROM export_jobs`).get() as { cnt: number };

      return {
        service: "reporting",
        ok: true,
        durationMs: Date.now() - start,
        details: {
          basic,
          statusCounts,
          totalJobs: totalJobs.cnt,
        },
      };
    } finally {
      db.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      service: "reporting",
      ok: false,
      durationMs: Date.now() - start,
      details: {},
      error: msg,
    };
  }
}

/**
 * Dispatch to the appropriate verifier for a service.
 */
export async function verifyService(
  serviceName: string,
  dbPath: string,
  config: BackupConfig
): Promise<VerificationResult> {
  switch (serviceName) {
    case "audit-log":
      return verifyAuditLog(dbPath, config);
    case "keeper":
      return verifyKeeper(dbPath);
    case "reporting":
      return verifyReporting(dbPath);
    default:
      return {
        service: serviceName,
        ok: false,
        durationMs: 0,
        details: {},
        error: `Unknown service: ${serviceName}`,
      };
  }
}

/**
 * Verify a restored database and measure RTO.
 */
export async function verifyRestore(
  serviceName: string,
  backupPath: string,
  config: BackupConfig
): Promise<VerificationResult & { rtoMs: number }> {
  const overallStart = Date.now();

  // Restore to a temporary location
  const tmpDir = fs.mkdtempSync(path.join("/tmp", `kora-restore-${serviceName}-`));
  const restoredPath = path.join(tmpDir, `${serviceName}.db`);

  try {
    // Copy backup to temp location (simulating restore)
    fs.copyFileSync(backupPath, restoredPath);

    // Verify the restored database
    const result = await verifyService(serviceName, restoredPath, config);

    return {
      ...result,
      rtoMs: Date.now() - overallStart,
    };
  } finally {
    // Cleanup temp directory
    try {
      if (fs.existsSync(restoredPath)) fs.unlinkSync(restoredPath);
      fs.rmdirSync(tmpDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Find the latest backup file for a service across all tiers.
 */
export function findLatestBackup(config: BackupConfig, serviceName: string): string | null {
  for (const tier of ["hot", "warm", "cold"] as const) {
    const backups = listBackupsForVerification(config, serviceName, tier);
    if (backups.length > 0) {
      return backups[0].path;
    }
  }
  return null;
}

// Re-export listBackups from retention for use here
import { listBackups } from "./retention";
function listBackupsForVerification(config: BackupConfig, serviceName: string, tier: "hot" | "warm" | "cold") {
  return listBackups(config, serviceName, tier);
}