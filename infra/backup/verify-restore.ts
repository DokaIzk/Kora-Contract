#!/usr/bin/env node
/**
 * Verify Restore Script — Automated restore verification for disaster recovery.
 *
 * This script:
 * 1. Finds the latest backup for a service (across all tiers)
 * 2. Restores to an isolated temporary directory
 * 3. Runs service-specific integrity verification
 * 4. Reports RTO (Recovery Time Objective) measurement
 * 5. Cleans up temporary files
 *
 * Usage:
 *   node verify-restore.js --service <name> [--tier <hot|warm|cold>] [--config <path>] [--auto]
 *
 * Examples:
 *   node verify-restore.js --service audit-log --auto
 *   node verify-restore.js --service keeper --tier warm
 *   node verify-restore.js --service reporting --auto --json
 */

import * as fs from "fs";
import * as path from "path";
import { loadConfig, findLatestBackup } from "./lib/config";
import { restoreSqlite, verifyHashSidecar } from "./lib/sqlite";
import { verifyService, VerificationResult } from "./lib/verify";
import { listBackups } from "./lib/retention";
import pino from "pino";

const logger = pino({ name: "verify-restore", level: process.env.LOG_LEVEL || "info" });

interface CliArgs {
  service?: string;
  tier?: "hot" | "warm" | "cold";
  config?: string;
  auto: boolean;
  json: boolean;
  db?: string; // For manual verification of a specific DB
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { auto: false, json: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--service":
        result.service = args[++i];
        break;
      case "--tier":
        result.tier = args[++i] as "hot" | "warm" | "cold";
        break;
      case "--config":
        result.config = args[++i];
        break;
      case "--auto":
        result.auto = true;
        break;
      case "--json":
        result.json = true;
        break;
      case "--db":
        result.db = args[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`
Usage: node verify-restore.js [options]

Options:
  --service <name>        Service to verify (audit-log, keeper, reporting) [required]
  --tier <hot|warm|cold>  Specific tier to verify (default: latest across all tiers)
  --config <path>         Path to config.json
  --auto                  Automated mode: find latest backup, restore to temp, verify, cleanup
  --json                  Output results as JSON
  --db <path>             Verify a specific database file directly (skips restore)
  --help, -h              Show this help

Exit codes:
  0  Verification passed
  1  Verification failed
  2  Invalid arguments / configuration error
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.service) {
    console.error("Error: --service is required");
    printUsage();
    process.exit(2);
  }

  const config = loadConfig(args.config);

  if (!config.services[args.service]) {
    logger.error({ service: args.service }, "Unknown service");
    process.exit(2);
  }

  // If --db provided, verify that database directly
  if (args.db) {
    const result = await verifyService(args.service, args.db, config);
    outputResult(result, args.json);
    process.exit(result.ok ? 0 : 1);
  }

  // Find backup to verify
  let backupPath: string | null = null;
  let tierUsed: "hot" | "warm" | "cold" | "unknown" = "unknown";

  if (args.tier) {
    // Use specific tier
    const backups = listBackups(config, args.service, args.tier);
    if (backups.length === 0) {
      logger.error({ service: args.service, tier: args.tier }, "No backups found in tier");
      process.exit(1);
    }
    backupPath = backups[0].path;
    tierUsed = args.tier;
  } else if (args.auto) {
    // Auto mode: find latest across all tiers
    backupPath = findLatestBackup(config, args.service);
    if (backupPath) {
      // Determine which tier it came from
      for (const tier of ["hot", "warm", "cold"] as const) {
        const backups = listBackups(config, args.service, tier);
        if (backups.some((b) => b.path === backupPath)) {
          tierUsed = tier;
          break;
        }
      }
    }
  } else {
    console.error("Error: Must specify --tier or use --auto");
    printUsage();
    process.exit(2);
  }

  if (!backupPath) {
    logger.error({ service: args.service }, "No backup found to verify");
    process.exit(1);
  }

  logger.info({ service: args.service, backupPath, tier: tierUsed }, "Starting restore verification");

  // Verify hash sidecar first
  const hashOk = await verifyHashSidecar(backupPath);
  if (!hashOk) {
    logger.error({ backupPath }, "Backup hash verification failed");
    const result: VerificationResult = {
      service: args.service,
      ok: false,
      durationMs: 0,
      details: { tier: tierUsed, backupPath },
      error: "Backup hash verification failed",
    };
    outputResult(result, args.json);
    process.exit(1);
  }

  // Restore to temporary directory and verify
  const overallStart = Date.now();
  const tmpDir = fs.mkdtempSync(path.join("/tmp", `kora-verify-${args.service}-`));
  const restoredPath = path.join(tmpDir, `${args.service}.db`);

  let result: VerificationResult;

  try {
    // Restore
    const restoreStart = Date.now();
    restoreSqlite(backupPath, restoredPath);
    const restoreDurationMs = Date.now() - restoreStart;

    // Verify
    result = await verifyService(args.service, restoredPath, config);
    result.durationMs = Date.now() - overallStart;
    result.details = {
      ...result.details,
      tier: tierUsed,
      backupPath,
      restoreDurationMs,
      rtoMs: result.durationMs,
    };
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(restoredPath)) fs.unlinkSync(restoredPath);
      fs.rmdirSync(tmpDir);
    } catch {
      // Ignore
    }
  }

  outputResult(result, args.json);
  process.exit(result.ok ? 0 : 1);
}

function outputResult(result: VerificationResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const status = result.ok ? "✅ PASS" : "❌ FAIL";
    console.log(`\n${status} — ${result.service} verification`);
    console.log(`  Duration: ${result.durationMs}ms`);
    console.log(`  RTO: ${result.details.rtoMs ?? result.durationMs}ms`);
    if (result.details.tier) console.log(`  Tier: ${result.details.tier}`);
    if (result.details.restoreDurationMs) console.log(`  Restore time: ${result.details.restoreDurationMs}ms`);
    if (result.error) console.log(`  Error: ${result.error}`);
    if (result.details.basic) {
      console.log(`  Tables: ${result.details.basic.tables.join(", ")}`);
      console.log(`  Row counts: ${JSON.stringify(result.details.basic.rowCounts)}`);
    }
  }
}

main().catch((err) => {
  logger.error(err, "Verify-restore script crashed");
  const result: VerificationResult = {
    service: "unknown",
    ok: false,
    durationMs: 0,
    details: {},
    error: err instanceof Error ? err.message : String(err),
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
});