/**
 * IPFS Pinning Service — SQLite pin-status store
 *
 * Small database for the periodic verification job: every successful pin
 * writes a record; the verifier job reads all records, checks persistence per
 * provider, and re-pins/alerts on failure.
 *
 * Issue #754
 */

import Database, { Database as DB } from "better-sqlite3";
import { PinStatusRecord } from "./types";

export class PinStore {
  private db: DB;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ipfs_pins (
        cid                 TEXT PRIMARY KEY,
        filename            TEXT NOT NULL,
        size_bytes          INTEGER NOT NULL,
        sha256_hex          TEXT NOT NULL,
        status              TEXT NOT NULL,
        providers           TEXT NOT NULL,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        last_verified_at    INTEGER,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  upsert(rec: PinStatusRecord): void {
    this.db
      .prepare(
        `INSERT INTO ipfs_pins
           (cid, filename, size_bytes, sha256_hex, status, providers, created_at, updated_at, last_verified_at, consecutive_failures)
         VALUES (@cid, @filename, @sizeBytes, @sha256Hex, @status, @providers, @createdAt, @updatedAt, @lastVerifiedAt, @consecutiveFailures)
         ON CONFLICT(cid) DO UPDATE SET
           status=excluded.status, providers=excluded.providers,
           updated_at=excluded.updated_at, last_verified_at=excluded.last_verified_at,
           consecutive_failures=excluded.consecutive_failures`,
      )
      .run({ ...rec });
  }

  get(cid: string): PinStatusRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM ipfs_pins WHERE cid = ?`).get(cid) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  listAll(): PinStatusRecord[] {
    const rows = this.db.prepare(`SELECT * FROM ipfs_pins ORDER BY created_at ASC`).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  close(): void {
    this.db.close();
  }

  private mapRow(r: Record<string, unknown>): PinStatusRecord {
    return {
      cid: r["cid"] as string,
      filename: r["filename"] as string,
      sizeBytes: r["size_bytes"] as number,
      sha256Hex: r["sha256_hex"] as string,
      status: r["status"] as PinStatusRecord["status"],
      providers: r["providers"] as string,
      createdAt: r["created_at"] as number,
      updatedAt: r["updated_at"] as number,
      lastVerifiedAt: r["last_verified_at"] as number | null,
      consecutiveFailures: r["consecutive_failures"] as number,
    };
  }
}
