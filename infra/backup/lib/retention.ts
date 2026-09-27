/**
 * Retention Policy Enforcement
 *
 * Implements the three-tier retention policy:
 * - Hot: every 15 min, retain 4 hours
 * - Warm: hourly, retain 7 days
 * - Cold: daily at 02:00 UTC, retain 90 days
 */

import * as fs from "fs";
import * as path from "path";
import { BackupConfig, RetentionTierConfig } from "./config";
import pino from "pino";

const logger = pino({ name: "backup:retention" });

export type TierName = "hot" | "warm" | "cold";

interface BackupFile {
  path: string;
  name: string;
  timestamp: Date;
  size: number;
}

/**
 * Parse timestamp from backup filename.
 * Expected format: `service-YYYYMMDDTHHMMSSZ.db`
 */
function parseBackupTimestamp(filename: string): Date | null {
  // Match: service-20260115T143000Z.db
  const match = filename.match(/-(\d{8}T\d{6}Z)\.db$/);
  if (!match) return null;

  const ts = match[1];
  // Parse as UTC: YYYYMMDDTHHMMSSZ
  const year = parseInt(ts.slice(0, 4), 10);
  const month = parseInt(ts.slice(4, 6), 10) - 1;
  const day = parseInt(ts.slice(6, 8), 10);
  const hour = parseInt(ts.slice(9, 11), 10);
  const minute = parseInt(ts.slice(11, 13), 10);
  const second = parseInt(ts.slice(13, 15), 10);

  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * List all backup files in a tier directory for a service.
 */
export function listBackups(config: BackupConfig, serviceName: string, tier: TierName): BackupFile[] {
  const dir = path.join(config.backupRoot, tier, serviceName);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir);
  const backups: BackupFile[] = [];

  for (const file of files) {
    if (!file.endsWith(".db")) continue; // Skip .sha256 sidecars
    const filePath = path.join(dir, file);
    const timestamp = parseBackupTimestamp(file);
    if (!timestamp) continue;

    const stats = fs.statSync(filePath);
    backups.push({ path: filePath, name: file, timestamp, size: stats.size });
  }

  // Sort newest first
  backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return backups;
}

/**
 * Determine if a backup file should be retained based on tier policy.
 */
export function shouldRetain(
  backup: BackupFile,
  tier: TierName,
  retention: BackupConfig["retention"],
  now: Date = new Date()
): boolean {
  const tierConfig = retention[tier];
  const ageMs = now.getTime() - backup.timestamp.getTime();

  if (tier === "hot" && tierConfig.maxAgeHours) {
    return ageMs <= tierConfig.maxAgeHours * 60 * 60 * 1000;
  }
  if (tier === "warm" && tierConfig.maxAgeDays) {
    return ageMs <= tierConfig.maxAgeDays * 24 * 60 * 60 * 1000;
  }
  if (tier === "cold" && tierConfig.maxAgeDays) {
    return ageMs <= tierConfig.maxAgeDays * 24 * 60 * 60 * 1000;
  }

  return true; // Default: retain
}

/**
 * Enforce retention policy for a service across all tiers.
 * Deletes expired backup files and their .sha256 sidecars.
 *
 * @returns Number of files deleted
 */
export function enforceRetention(config: BackupConfig, serviceName: string): number {
  let deleted = 0;
  const now = new Date();

  for (const tier of ["hot", "warm", "cold"] as TierName[]) {
    const backups = listBackups(config, serviceName, tier);
    const tierConfig = config.retention[tier];

    for (const backup of backups) {
      if (!shouldRetain(backup, tier, config.retention, now)) {
        try {
          fs.unlinkSync(backup.path);
          // Also delete sidecar
          const sidecar = `${backup.path}.sha256`;
          if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
          logger.info({ file: backup.name, tier }, "Deleted expired backup");
          deleted++;
        } catch (err) {
          logger.error({ file: backup.name, err }, "Failed to delete expired backup");
        }
      }
    }
  }

  return deleted;
}

/**
 * Enforce retention for all configured services.
 */
export function enforceRetentionAll(config: BackupConfig): Record<string, number> {
  const results: Record<string, number> = {};
  for (const serviceName of Object.keys(config.services)) {
    results[serviceName] = enforceRetention(config, serviceName);
  }
  return results;
}

/**
 * Get the next scheduled backup time for a tier (for monitoring).
 */
export function getNextBackupTime(tier: TierName, retention: BackupConfig["retention"], from: Date = new Date()): Date {
  const next = new Date(from);

  if (tier === "hot") {
    const interval = retention.hot.intervalMinutes ?? 15;
    const minutes = next.getUTCMinutes();
    const nextInterval = Math.ceil((minutes + 1) / interval) * interval;
    next.setUTCMinutes(nextInterval, 0, 0);
  } else if (tier === "warm") {
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
  } else if (tier === "cold") {
    const [hour, minute] = (retention.cold.timeUtc ?? "02:00").split(":").map(Number);
    next.setUTCHours(hour, minute, 0, 0);
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}