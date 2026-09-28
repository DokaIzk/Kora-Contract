/**
 * Backup Configuration Loader
 *
 * Loads and validates backup configuration from config.json with environment variable overrides.
 */

import * as fs from "fs";
import * as path from "path";

export interface ServiceConfig {
  dbPathEnv: string;
  defaultDbPath: string;
  verifyScript: "verify-chain" | "basic";
}

export interface RetentionTierConfig {
  intervalMinutes?: number;
  intervalHours?: number;
  intervalDays?: number;
  maxAgeHours?: number;
  maxAgeDays?: number;
  timeUtc?: string; // HH:MM format for daily backups
}

export interface RetentionConfig {
  hot: RetentionTierConfig;
  warm: RetentionTierConfig;
  cold: RetentionTierConfig;
}

export interface VerificationConfig {
  auditLog: {
    verifyBinary: string;
    verifyArgs: string[];
  };
}

export interface BackupConfig {
  backupRoot: string;
  services: Record<string, ServiceConfig>;
  retention: RetentionConfig;
  verification: VerificationConfig;
}

let cachedConfig: BackupConfig | null = null;

/**
 * Load configuration from config.json (or config.json.example as fallback)
 * with environment variable overrides.
 */
export function loadConfig(configPath?: string): BackupConfig {
  if (cachedConfig) return cachedConfig;

  const candidates = [
    configPath,
    path.resolve(process.cwd(), "config.json"),
    path.resolve(process.cwd(), "config.json.example"),
  ].filter(Boolean) as string[];

  let rawConfig: Partial<BackupConfig> = {};

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, "utf8");
      rawConfig = JSON.parse(content);
      break;
    }
  }

  // Environment variable overrides
  const backupRoot = process.env.BACKUP_ROOT ?? rawConfig.backupRoot ?? "/backups";

  // Build service configs with env var overrides for DB paths
  const services: Record<string, ServiceConfig> = {};
  const defaultServices = rawConfig.services ?? {};
  for (const [name, svc] of Object.entries(defaultServices)) {
    services[name] = {
      dbPathEnv: svc.dbPathEnv,
      defaultDbPath: process.env[svc.dbPathEnv] ?? svc.defaultDbPath,
      verifyScript: svc.verifyScript,
    };
  }

  // Ensure all three core services exist
  const requiredServices = ["audit-log", "keeper", "reporting"];
  for (const name of requiredServices) {
    if (!services[name]) {
      throw new Error(`Missing required service config: ${name}`);
    }
  }

  cachedConfig = {
    backupRoot,
    services,
    retention: rawConfig.retention ?? {
      hot: { intervalMinutes: 15, maxAgeHours: 4 },
      warm: { intervalHours: 1, maxAgeDays: 7 },
      cold: { intervalDays: 1, maxAgeDays: 90, timeUtc: "02:00" },
    },
    verification: rawConfig.verification ?? {
      auditLog: {
        verifyBinary: "node",
        verifyArgs: ["../services/audit-log/dist/verify.js", "--db"],
      },
    },
  };

  return cachedConfig;
}

/**
 * Get the source database path for a service (resolves env var or default).
 */
export function getDbPath(serviceName: string, config: BackupConfig): string {
  const svc = config.services[serviceName];
  if (!svc) throw new Error(`Unknown service: ${serviceName}`);
  return process.env[svc.dbPathEnv] ?? svc.defaultDbPath;
}

/**
 * Get the tier directory path (hot/warm/cold).
 */
export function getTierDir(config: BackupConfig, serviceName: string, tier: "hot" | "warm" | "cold"): string {
  return path.join(config.backupRoot, tier, serviceName);
}

/**
 * Generate a timestamped backup filename.
 */
export function makeBackupFilename(serviceName: string): string {
  const now = new Date().toISOString().replace(/[:.]/g, "").replace("T", "T").split(".")[0] + "Z";
  return `${serviceName}-${now}.db`;
}

/**
 * Reset cached config (for testing).
 */
export function resetConfig(): void {
  cachedConfig = null;
}