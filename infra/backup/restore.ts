#!/usr/bin/env node
/**
 * Restore Script — Restores a service database from a backup.
 *
 * Usage:
 *   node restore.js --service <name> --tier <hot|warm|cold> --target <path> [--backup <filename>] [--config <path>] [--list]
 *
 * Examples:
 *   node restore.js --service audit-log --tier hot --target ./restored-audit.db
 *   node restore.js --service keeper --tier warm --target ./restored-keeper.db --backup keeper-20260115T143000Z.db
 *   node restore.js --service reporting --tier cold --list
 */

import * as fs from "fs";
import * as path from "path";
import { loadConfig, getTierDir, listBackups } from "./lib/config";
import { restoreSqlite, verifyHashSidecar } from "./lib/sqlite";
import pino from "pino";

const logger = pino({ name: "restore", level: process.env.LOG_LEVEL || "info" });

interface CliArgs {
  service?: string;
  tier?: "hot" | "warm" | "cold";
  target?: string;
  backup?: string;
  config?: string;
  list: boolean;
  force: boolean;
  verify: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { list: false, force: false, verify: true };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--service":
        result.service = args[++i];
        break;
      case "--tier":
        result.tier = args[++i] as "hot" | "warm" | "cold";
        break;
      case "--target":
        result.target = args[++i];
        break;
      case "--backup":
        result.backup = args[++i];
        break;
      case "--config":
        result.config = args[++i];
        break;
      case "--list":
        result.list = true;
        break;
      case "--force":
        result.force = true;
        break;
      case "--no-verify":
        result.verify = false;
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
Usage: node restore.js [options]

Options:
  --service <name>        Service to restore (audit-log, keeper, reporting) [required unless --list]
  --tier <hot|warm|cold>  Backup tier to restore from [required unless --list]
  --target <path>         Target path for restored database [required unless --list]
  --backup <filename>     Specific backup file to restore (default: latest in tier)
  --config <path>         Path to config.json
  --list                  List available backups for service/tier
  --force                 Overwrite target if it exists
  --no-verify             Skip hash sidecar verification
  --help, -h              Show this help
`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = loadConfig(args.config);

  if (args.list) {
    if (!args.service || !args.tier) {
      console.error("Error: --list requires --service and --tier");
      printUsage();
      process.exit(1);
    }
    await listBackupsCommand(config, args.service, args.tier);
    return;
  }

  if (!args.service || !args.tier || !args.target) {
    console.error("Error: --service, --tier, and --target are required");
    printUsage();
    process.exit(1);
  }

  if (!config.services[args.service]) {
    logger.error({ service: args.service }, "Unknown service");
    process.exit(1);
  }

  const tierDir = getTierDir(config, args.service, args.tier);

  if (!fs.existsSync(tierDir)) {
    logger.error({ tierDir }, "Tier directory does not exist");
    process.exit(1);
  }

  // Determine which backup to restore
  let backupPath: string;
  if (args.backup) {
    backupPath = path.join(tierDir, args.backup);
    if (!fs.existsSync(backupPath)) {
      logger.error({ backupPath }, "Specified backup file not found");
      process.exit(1);
    }
  } else {
    // Find latest backup in tier
    const backups = listBackups(config, args.service, args.tier);
    if (backups.length === 0) {
      logger.error({ service: args.service, tier: args.tier }, "No backups found in tier");
      process.exit(1);
    }
    backupPath = backups[0].path;
    logger.info({ backup: backups[0].name }, "Using latest backup");
  }

  // Verify hash sidecar if requested
  if (args.verify) {
    const verified = await verifyHashSidecar(backupPath);
    if (!verified) {
      logger.error({ backupPath }, "Hash verification failed — backup may be corrupted");
      process.exit(1);
    }
    logger.info("Hash verification passed");
  }

  // Check target
  if (fs.existsSync(args.target) && !args.force) {
    logger.error({ target: args.target }, "Target file exists (use --force to overwrite)");
    process.exit(1);
  }

  // Perform restore
  logger.info({ backupPath, target: args.target }, "Restoring database");
  restoreSqlite(backupPath, args.target);

  logger.info({ target: args.target }, "Restore completed successfully");
}

async function listBackupsCommand(
  config: ReturnType<typeof loadConfig>,
  serviceName: string,
  tier: "hot" | "warm" | "cold"
): Promise<void> {
  const backups = listBackups(config, serviceName, tier);

  if (backups.length === 0) {
    console.log(`No backups found for ${serviceName}/${tier}`);
    return;
  }

  console.log(`Backups for ${serviceName}/${tier} (newest first):`);
  console.log("");

  for (const backup of backups) {
    const hasSidecar = fs.existsSync(`${backup.path}.sha256`);
    const sizeMb = (backup.size / 1024 / 1024).toFixed(2);
    const ageHours = ((Date.now() - backup.timestamp.getTime()) / 1000 / 60 / 60).toFixed(1);
    console.log(`  ${backup.name}`);
    console.log(`    Size: ${sizeMb} MB  |  Age: ${ageHours}h  |  Hash: ${hasSidecar ? "verified" : "MISSING"}`);
  }
}

main().catch((err) => {
  logger.error(err, "Restore script crashed");
  process.exit(1);
});