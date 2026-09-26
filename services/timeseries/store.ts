/**
 * Time-series store interface + in-memory implementation.
 *
 * In production this is replaced by a time-series-optimised backend
 * (TimescaleDB, InfluxDB, or DynamoDB with composite keys).
 * The interface is storage-agnostic so the service layer is testable in
 * isolation.
 *
 * Issue: #763
 */

import {
  DownsampledBucket,
  DownsampleGranularity,
  RangeQueryInput,
  SeriesKind,
  TimeSeriesPoint,
} from "./types";

// ── Storage interface ─────────────────────────────────────────────────────────

export interface TimeSeriesStore {
  /**
   * Insert a data point.  If a point with the same (kind, subject, timestampMs)
   * already exists the insert is a no-op (idempotent backfill).
   */
  insert(point: TimeSeriesPoint): Promise<void>;

  /**
   * Batch-insert data points.  Each point is inserted idempotently.
   * @returns Number of *new* points actually written (duplicates are skipped).
   */
  insertBatch(points: TimeSeriesPoint[]): Promise<number>;

  /** Range query — returns raw points ordered by timestampMs ascending. */
  queryRange(input: RangeQueryInput): Promise<TimeSeriesPoint[]>;

  /** Return pre-computed downsampled buckets for a range. */
  queryDownsampled(
    kind: SeriesKind,
    subject: string,
    fromMs: number,
    toMs: number,
    granularity: DownsampleGranularity
  ): Promise<DownsampledBucket[]>;

  /** Upsert a pre-computed downsampled bucket. */
  upsertBucket(bucket: DownsampledBucket): Promise<void>;

  /** Delete raw points older than `beforeMs`. */
  pruneRaw(kind: SeriesKind, beforeMs: number): Promise<number>;

  /** Delete downsampled buckets older than `beforeMs`. */
  pruneDownsampled(kind: SeriesKind, beforeMs: number): Promise<number>;
}

// ── In-memory implementation ──────────────────────────────────────────────────

/** Composite key for deduplication: "kind|subject|timestampMs" */
function rawKey(p: TimeSeriesPoint): string {
  return `${p.kind}|${p.subject}|${p.timestampMs}`;
}

function bucketKey(b: DownsampledBucket): string {
  return `${b.kind}|${b.subject}|${b.granularity}|${b.bucketStartMs}`;
}

export class InMemoryTimeSeriesStore implements TimeSeriesStore {
  private readonly _points = new Map<string, TimeSeriesPoint>();
  private readonly _buckets = new Map<string, DownsampledBucket>();

  async insert(point: TimeSeriesPoint): Promise<void> {
    const key = rawKey(point);
    if (!this._points.has(key)) {
      this._points.set(key, point);
    }
    // Duplicate → no-op (idempotent)
  }

  async insertBatch(points: TimeSeriesPoint[]): Promise<number> {
    let written = 0;
    for (const p of points) {
      const key = rawKey(p);
      if (!this._points.has(key)) {
        this._points.set(key, p);
        written++;
      }
    }
    return written;
  }

  async queryRange(input: RangeQueryInput): Promise<TimeSeriesPoint[]> {
    return Array.from(this._points.values())
      .filter(
        (p) =>
          p.kind === input.kind &&
          p.subject === input.subject &&
          p.timestampMs >= input.fromMs &&
          p.timestampMs <= input.toMs
      )
      .sort((a, b) => a.timestampMs - b.timestampMs);
  }

  async queryDownsampled(
    kind: SeriesKind,
    subject: string,
    fromMs: number,
    toMs: number,
    granularity: DownsampleGranularity
  ): Promise<DownsampledBucket[]> {
    return Array.from(this._buckets.values())
      .filter(
        (b) =>
          b.kind === kind &&
          b.subject === subject &&
          b.granularity === granularity &&
          b.bucketStartMs >= fromMs &&
          b.bucketStartMs <= toMs
      )
      .sort((a, b) => a.bucketStartMs - b.bucketStartMs);
  }

  async upsertBucket(bucket: DownsampledBucket): Promise<void> {
    this._buckets.set(bucketKey(bucket), bucket);
  }

  async pruneRaw(kind: SeriesKind, beforeMs: number): Promise<number> {
    let pruned = 0;
    for (const [key, p] of this._points) {
      if (p.kind === kind && p.timestampMs < beforeMs) {
        this._points.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  async pruneDownsampled(kind: SeriesKind, beforeMs: number): Promise<number> {
    let pruned = 0;
    for (const [key, b] of this._buckets) {
      if (b.kind === kind && b.bucketStartMs < beforeMs) {
        this._buckets.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}
