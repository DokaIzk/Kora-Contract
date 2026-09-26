/**
 * Keeper Service — Job Store
 *
 * Durable, restart-safe SQLite-backed job queue.
 * Deduplication is enforced at the DB level via a UNIQUE constraint on
 * `dedup_key`, so a restart can never re-enqueue an already-tracked deadline.
 *
 * Issue #765
 */

import Database, { Database as DB } from "better-sqlite3";
import { Job, JobStatus, TriggerOutcome, DeadlineKind, Deadline } from "./types";

export class JobStore {
  private db: DB;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.migrate();
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS keeper_jobs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        dedup_key        TEXT    NOT NULL UNIQUE,
        kind             TEXT    NOT NULL,
        invoice_id       TEXT    NOT NULL,
        deadline_ts      INTEGER NOT NULL,
        contract_address TEXT    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'pending',
        attempts         INTEGER NOT NULL DEFAULT 0,
        last_attempt_at  INTEGER,
        last_outcome     TEXT,
        last_tx_hash     TEXT,
        last_error       TEXT,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_keeper_jobs_status_deadline
        ON keeper_jobs (status, deadline_ts);
    `);
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a deadline as a job.
   * If `dedup_key` already exists the row is left untouched (INSERT OR IGNORE),
   * guaranteeing no duplicate dispatch across service restarts.
   */
  enqueue(deadline: Deadline): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO keeper_jobs
           (dedup_key, kind, invoice_id, deadline_ts, contract_address, status, created_at, updated_at)
         VALUES
           (@dedupKey, @kind, @invoiceId, @deadlineTs, @contractAddress, 'pending', @now, @now)`
      )
      .run({
        dedupKey: deadline.dedupKey,
        kind: deadline.kind,
        invoiceId: deadline.invoiceId.toString(),
        deadlineTs: deadline.deadlineTs,
        contractAddress: deadline.contractAddress,
        now,
      });
  }

  /**
   * Mark a job as "ready" (deadline has passed, eligible for dispatch).
   */
  markReady(dedupKey: string): void {
    this._updateStatus(dedupKey, "ready");
  }

  /**
   * Record a trigger attempt and its outcome.
   */
  recordAttempt(
    dedupKey: string,
    outcome: TriggerOutcome,
    txHash?: string,
    error?: string
  ): void {
    const now = Math.floor(Date.now() / 1000);
    const nextStatus = this._outcomeToStatus(outcome);
    this.db
      .prepare(
        `UPDATE keeper_jobs
         SET status          = @status,
             attempts        = attempts + 1,
             last_attempt_at = @now,
             last_outcome    = @outcome,
             last_tx_hash    = @txHash,
             last_error      = @error,
             updated_at      = @now
         WHERE dedup_key = @dedupKey`
      )
      .run({
        status: nextStatus,
        now,
        outcome,
        txHash: txHash ?? null,
        error: error ?? null,
        dedupKey,
      });
  }

  /**
   * Move a job to the dead-letter state after exhausting retries.
   */
  markDead(dedupKey: string, reason: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE keeper_jobs
         SET status = 'dead', last_error = @reason, updated_at = @now
         WHERE dedup_key = @dedupKey`
      )
      .run({ reason, now, dedupKey });
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Fetch all jobs that are ready to be dispatched (status=ready OR
   * status=failed but retry back-off has elapsed).
   */
  getDispatchable(nowTs: number, retryBackoffBaseMs: number, maxAttempts: number): Job[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM keeper_jobs
         WHERE status IN ('ready', 'failed')
           AND deadline_ts <= @nowTs
           AND attempts < @maxAttempts
         ORDER BY deadline_ts ASC`
      )
      .all({ nowTs, maxAttempts }) as RawRow[];

    return rows
      .map(rowToJob)
      .filter((job) => this._isRetryDue(job, retryBackoffBaseMs, nowTs));
  }

  /**
   * Advance all pending jobs whose deadline has now elapsed to "ready".
   */
  promoteExpired(nowTs: number): number {
    const result = this.db
      .prepare(
        `UPDATE keeper_jobs
         SET status = 'ready', updated_at = @nowTs
         WHERE status = 'pending' AND deadline_ts <= @nowTs`
      )
      .run({ nowTs });
    return result.changes;
  }

  /**
   * Returns the full job history — for observability/API.
   */
  getHistory(limit = 500): Job[] {
    const rows = this.db
      .prepare(`SELECT * FROM keeper_jobs ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as RawRow[];
    return rows.map(rowToJob);
  }

  /**
   * Returns jobs filtered by status.
   */
  getByStatus(status: JobStatus): Job[] {
    const rows = this.db
      .prepare(`SELECT * FROM keeper_jobs WHERE status = ? ORDER BY deadline_ts ASC`)
      .all(status) as RawRow[];
    return rows.map(rowToJob);
  }

  /**
   * Returns aggregate counts grouped by status — useful for a health endpoint.
   */
  getStatusCounts(): Record<JobStatus, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as cnt FROM keeper_jobs GROUP BY status`)
      .all() as { status: string; cnt: number }[];

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = row.cnt;
    return counts as Record<JobStatus, number>;
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _updateStatus(dedupKey: string, status: JobStatus): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE keeper_jobs SET status = @status, updated_at = @now WHERE dedup_key = @dedupKey`
      )
      .run({ status, now, dedupKey });
  }

  private _outcomeToStatus(outcome: TriggerOutcome): JobStatus {
    switch (outcome) {
      case "submitted":
        return "in_flight";
      case "already_triggered":
        return "done";
      case "failed":
        return "failed";
      case "permanent_failure":
        return "dead";
    }
  }

  /** Exponential back-off: wait base * 2^(attempts-1) before next retry. */
  private _isRetryDue(job: Job, backoffBaseMs: number, nowTs: number): boolean {
    if (job.status !== "failed") return true;
    if (job.lastAttemptAt == null) return true;
    const waitMs = backoffBaseMs * Math.pow(2, job.attempts - 1);
    const waitSec = Math.ceil(waitMs / 1000);
    return nowTs >= job.lastAttemptAt + waitSec;
  }
}

// ---------------------------------------------------------------------------
// SQLite row mapping
// ---------------------------------------------------------------------------

interface RawRow {
  id: number;
  dedup_key: string;
  kind: string;
  invoice_id: string;
  deadline_ts: number;
  contract_address: string;
  status: string;
  attempts: number;
  last_attempt_at: number | null;
  last_outcome: string | null;
  last_tx_hash: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function rowToJob(r: RawRow): Job {
  return {
    id: r.id,
    dedupKey: r.dedup_key,
    kind: r.kind as DeadlineKind,
    invoiceId: r.invoice_id,
    deadlineTs: r.deadline_ts,
    contractAddress: r.contract_address,
    status: r.status as JobStatus,
    attempts: r.attempts,
    lastAttemptAt: r.last_attempt_at,
    lastOutcome: r.last_outcome as TriggerOutcome | null,
    lastTxHash: r.last_tx_hash,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
