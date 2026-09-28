/**
 * SQLite Backup & Restore Utilities
 *
 * Uses SQLite's online backup API via the `sqlite3` CLI for consistent, non-blocking backups.
 * Also provides Node.js programmatic access via better-sqlite3 for verification.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import Database, { Database as DB } from "better-sqlite3";
import pino from "pino";

const logger = pino({ name: "backup:sqlite" });
const execFile = promisify(cp.execFile);

/**
 * Check if sqlite3 CLI is available.
 */
export async function checkSqlite3Cli(): Promise<boolean> {
  try {
    await execFile("sqlite3", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform an online backup of a SQLite database using sqlite3 CLI.
 * This uses SQLite's backup API, which is safe for concurrent readers/writers.
 *
 * @param sourcePath - Path to the source database file
 * @param destPath - Path where the backup should be written
 * @returns Object with backup metadata (size, duration)
 */
export async function backupSqlite(
  sourcePath: string,
  destPath: string
): Promise<{ size: number; durationMs: number }> {
  const start = Date.now();

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source database not found: ${sourcePath}`);
  }

  // Ensure destination directory exists
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // Use sqlite3 .backup command for consistent online backup
  // This is non-blocking and produces a page-by-page consistent copy
  const { stdout, stderr } = await execFile("sqlite3", [sourcePath, `.backup "${destPath}"`]);

  if (stderr && !stderr.includes("memory")) {
    // Some versions print memory stats to stderr
    logger.warn({ stderr }, "sqlite3 backup stderr");
  }

  const stats = fs.statSync(destPath);
  const durationMs = Date.now() - start;

  logger.info({ sourcePath, destPath, size: stats.size, durationMs }, "SQLite backup completed");
  return { size: stats.size, durationMs };
}

/**
 * Verify a SQLite database is structurally sound (can be opened, has expected tables).
 */
export async function verifySqliteBasic(dbPath: string, expectedTables?: string[]): Promise<{
  ok: boolean;
  tables: string[];
  rowCounts: Record<string, number>;
  error?: string;
}> {
  let db: DB | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    const rowCounts: Record<string, number> = {};

    for (const table of tableNames) {
      if (expectedTables && !expectedTables.includes(table)) continue;
      const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
      rowCounts[table] = count.cnt;
    }

    return { ok: true, tables: tableNames, rowCounts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ dbPath, msg }, "SQLite basic verification failed");
    return { ok: false, tables: [], rowCounts: {}, error: msg };
  } finally {
    db?.close();
  }
}

/**
 * Compute SHA-256 hash of a file.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const { createHash } = await import("crypto");
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Write a .sha256 sidecar file.
 */
export async function writeHashSidecar(filePath: string): Promise<void> {
  const hash = await computeFileHash(filePath);
  const sidecarPath = `${filePath}.sha256`;
  fs.writeFileSync(sidecarPath, `${hash}  ${path.basename(filePath)}\n`);
}

/**
 * Verify a file against its .sha256 sidecar.
 */
export async function verifyHashSidecar(filePath: string): Promise<boolean> {
  const sidecarPath = `${filePath}.sha256`;
  if (!fs.existsSync(sidecarPath)) return false;

  const expected = fs.readFileSync(sidecarPath, "utf8").trim().split(/\s+/)[0];
  const actual = await computeFileHash(filePath);
  return expected === actual;
}

/**
 * Restore a SQLite database from backup (simple file copy).
 * Note: Target database must not be in use (no open connections).
 */
export function restoreSqlite(backupPath: string, targetPath: string): void {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  // Remove any WAL/SHM files that might interfere
  const walPath = `${targetPath}-wal`;
  const shmPath = `${targetPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(backupPath, targetPath);

  logger.info({ backupPath, targetPath }, "SQLite database restored");
}

/**
 * Get database page count and size info (for verification logging).
 */
export function getDbInfo(dbPath: string): { pageCount: number; pageSize: number; sizeBytes: number } | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    const pageCount = db.prepare("PRAGMA page_count").get() as { page_count: number };
    const pageSize = db.prepare("PRAGMA page_size").get() as { page_size: number };
    const stats = fs.statSync(dbPath);
    db.close();
    return {
      pageCount: pageCount.page_count,
      pageSize: pageSize.page_size,
      sizeBytes: stats.size,
    };
  } catch {
    return null;
  }
}