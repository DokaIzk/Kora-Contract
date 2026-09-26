/**
 * Audit Log Service — Audit Store
 *
 * Append-only, hash-chained SQLite store for off-chain audit records.
 *
 * Concurrency design:
 *   SQLite's WAL mode + a per-process write serialisation mutex
 *   (implemented with a simple Promise queue) ensures that concurrent
 *   writers from multiple services never break chain ordering.
 *   For multi-process deployments, SQLite's file-level locking provides
 *   additional safety — but single-process/single-DB is the recommended
 *   production topology.
 *
 * Issue #768
 */

import Database, { Database as DB } from "better-sqlite3";
import {
  AuditRecord,
  AuditService,
  AuditAction,
  GENESIS_HASH,
  computeRecordHash,
} from "./types";

export class AuditStore {
  private db: DB;
  /** Serialises all writes to prevent concurrent sequence/hash races. */
  private writeLock: Promise<void> = Promise.resolve();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        sequence    INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp   INTEGER NOT NULL,
        service     TEXT    NOT NULL,
        action      TEXT    NOT NULL,
        actor_hash  TEXT    NOT NULL,
        metadata    TEXT    NOT NULL,
        prev_hash   TEXT    NOT NULL,
        record_hash TEXT    NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_log_service   ON audit_log (service);
    `);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Append a new audit record to the chain.
   * Serialised internally — safe to call from concurrent async contexts.
   *
   * NEVER pass raw PII in `actorIdentity` — pass a pre-hashed string.
   */
  async append(
    service: AuditService,
    action: AuditAction,
    actorHash: string,
    metadata: Record<string, unknown>
  ): Promise<AuditRecord> {
    // Queue the write behind any in-flight write
    let resolve!: () => void;
    const current = this.writeLock;
    this.writeLock = new Promise<void>((r) => { resolve = r; });

    await current;
    try {
      return this._appendSync(service, action, actorHash, metadata);
    } finally {
      resolve();
    }
  }

  private _appendSync(
    service: AuditService,
    action: AuditAction,
    actorHash: string,
    metadata: Record<string, unknown>
  ): AuditRecord {
    const prevHash = this._getLastHash();
    const timestamp = Date.now();

    // We don't know sequence yet (AUTOINCREMENT) — use a sentinel and update
    // after insert. We compute sequence by inspecting the last row.
    const lastSeq = this._getLastSequence();
    const sequence = lastSeq + 1;

    const partial: Omit<AuditRecord, "recordHash"> = {
      sequence,
      timestamp,
      service,
      action,
      actorHash,
      metadata,
      prevHash,
    };

    const recordHash = computeRecordHash(partial);

    this.db
      .prepare(
        `INSERT INTO audit_log
           (timestamp, service, action, actor_hash, metadata, prev_hash, record_hash)
         VALUES
           (@timestamp, @service, @action, @actorHash, @metadata, @prevHash, @recordHash)`
      )
      .run({
        timestamp,
        service,
        action,
        actorHash,
        metadata: JSON.stringify(metadata),
        prevHash,
        recordHash,
      });

    return { ...partial, recordHash };
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  getAll(): AuditRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ORDER BY sequence ASC`)
      .all() as RawRow[];
    return rows.map(rowToRecord);
  }

  getByService(service: AuditService): AuditRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit_log WHERE service = ? ORDER BY sequence ASC`)
      .all(service) as RawRow[];
    return rows.map(rowToRecord);
  }

  getRange(fromSeq: number, toSeq: number): AuditRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log WHERE sequence BETWEEN ? AND ? ORDER BY sequence ASC`
      )
      .all(fromSeq, toSeq) as RawRow[];
    return rows.map(rowToRecord);
  }

  getCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM audit_log`)
      .get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _getLastHash(): string {
    const row = this.db
      .prepare(`SELECT record_hash FROM audit_log ORDER BY sequence DESC LIMIT 1`)
      .get() as { record_hash: string } | undefined;
    return row?.record_hash ?? GENESIS_HASH;
  }

  private _getLastSequence(): number {
    const row = this.db
      .prepare(`SELECT sequence FROM audit_log ORDER BY sequence DESC LIMIT 1`)
      .get() as { sequence: number } | undefined;
    return row?.sequence ?? 0;
  }
}

// ---------------------------------------------------------------------------
// SQLite row mapping
// ---------------------------------------------------------------------------

interface RawRow {
  sequence: number;
  timestamp: number;
  service: string;
  action: string;
  actor_hash: string;
  metadata: string;
  prev_hash: string;
  record_hash: string;
}

function rowToRecord(r: RawRow): AuditRecord {
  return {
    sequence: r.sequence,
    timestamp: r.timestamp,
    service: r.service as AuditRecord["service"],
    action: r.action as AuditRecord["action"],
    actorHash: r.actor_hash,
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
    prevHash: r.prev_hash,
    recordHash: r.record_hash,
  };
}
