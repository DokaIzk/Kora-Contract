#!/usr/bin/env node
/**
 * Backup Script — Creates tiered backups of all stateful service databases.
 *
 * Usage:
 *   node backup.js [--all] [--service <name>] [--tier <hot|warm|cold>] [--config <path>]
 *
 * Examples:
 *   node backup.js --all --tier hot
 *   node backup.js --service audit-log --tier warm
 *   node backup.js --all --config ./config.json
 */

import * as fs from "fs";
import * as path from "path";
import { loadConfig, getDbPath, getTierDir, makeBackupFilename } from "./lib/config";
import { backupSqlite, checkSqlite3Cli, writeHashSidecar } from "./lib/sqlite";
import { enforceRetentionAll } from "./lib/retention";
import pino from "pino";

const logger = pino({ name: "backup", level: process.env.LOG_LEVEL || "info" });

interface CliArgs {
  all: boolean;
  service?: string;
  tier?: "hot" | "warm" | "cold";
  config?: string;
  noRetention: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { all: false, noRetention: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--all":
        result.all = true;
        break;
      case "--service":
        result.service = args[++i];
        break;
      case "--tier":
        result.tier = args[++i] as "hot" | "warm" | "cold";
        break;
      case "--config":
        result.config = args[++i];
        break;
      case "--no-retention":
        result.noRetention = true;
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
Usage: node backup.js [options]

Options:
  --all                 Backup all configured services
  --service <name>      Backup specific service (audit-log, keeper, reporting)
  --tier <hot|warm|cold>  Backup tier (default: hot)
  --config <path>       Path to config.json
  --no-retention        Skip retention cleanup after backup
  --help, -h            Show this help

Environment variables:
  BACKUP_ROOT           Root backup directory (default: /backups)
  AUDIT_DB_PATH         Audit log database path
  KEEPER_DB_PATH        Keeper database path
  REPORTING_DB_PATH     Reporting database path
  LOG_LEVEL             Log level (debug, info, warn, error)
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.all && !args.service) {
    console.error("Error: Must specify --all or --service");
    printUsage();
    process.exit(1);
  }

  const tier = args.tier ?? "hot";
  const config = loadConfig(args.config);

  // Verify sqlite3 CLI is available
  const hasSqlite3 = await checkSqlite3Cli();
  if (!hasSqlite3) {
    logger.error("sqlite3 CLI not found. Install sqlite3 package.");
    process.exit(1);
  }

  const servicesToBackup = args.all
    ? Object.keys(config.services)
    : [args.service!];

  // Validate service names
  for (const svc of servicesToBackup) {
    if (!config.services[svc]) {
      logger.error({ service: svc }, "Unknown service");
      process.exit(1);
    }
  }

  logger.info({ services: servicesToBackup, tier }, "Starting backup");

  let hasErrors = false;

  for (const serviceName of servicesToBackup) {
    try {
      const dbPath = getDbPath(serviceName, config);
      const tierDir = getTierDir(config, serviceName, tier);
      const backupName = makeBackupFilename(serviceName);
      const backupPath = path.join(tierDir, backupName);

      logger.info({ service: serviceName, dbPath, backupPath }, "Backing up service");

      const { size, durationMs } = await backupSqlite(dbPath, backupPath);

      // Write hash sidecar
      await writeHashSidecar(backupPath);

      logger.info(
        { service: serviceName, backupPath, size, durationMs },
        "Backup completed successfully"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ service: serviceName, error: msg }, "Backup failed");
      hasErrors = true;
    }
  }

  // Run retention cleanup unless disabled
  if (!args.noRetention) {
    logger.info("Running retention cleanup");
    const deleted = enforceRetentionAll(config);
    logger.info({ deleted }, "Retention cleanup completed");
  }

  if (hasErrors) {
    logger.error("One or more backups failed");
    process.exit(1);
  }

  logger.info("All backups completed successfully");
}

main().catch((err) => {
  logger.error(err, "Backup script crashed");
  process.exit(1);
});