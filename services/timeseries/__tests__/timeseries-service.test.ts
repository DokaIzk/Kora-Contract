/**
 * Time-series service tests — issue #763
 *
 * Covers:
 *  - Downsampling accuracy (min/max/avg correctness per bucket)
 *  - Backfill deduplication (duplicate points never double-counted)
 *  - Range-query correctness at boundary timestamps (inclusive/exclusive edges)
 *  - Retention pruning (raw vs downsampled windows)
 *  - On-the-fly fallback when no pre-computed buckets exist
 */

import { bucketStart, downsample } from "../downsampler";
import { InMemoryTimeSeriesStore } from "../store";
import { TimeSeriesService } from "../timeseries-service";
import { TimeSeriesPoint } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** Returns the start of the UTC day containing `ms`. */
function dayStart(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

function makePoint(subject: string, timestampMs: number, value: number): TimeSeriesPoint {
  return { kind: "pool-yield", subject, timestampMs, value };
}

function makeService(): TimeSeriesService {
  return new TimeSeriesService(new InMemoryTimeSeriesStore());
}

// ── bucketStart ───────────────────────────────────────────────────────────────

describe("bucketStart", () => {
  it("daily bucket aligns to UTC midnight", () => {
    const ts = new Date("2025-06-15T14:30:00Z").getTime();
    const expected = new Date("2025-06-15T00:00:00Z").getTime();
    expect(bucketStart(ts, "daily")).toBe(expected);
  });

  it("different times on same day map to the same bucket", () => {
    const t1 = new Date("2025-06-15T00:00:01Z").getTime();
    const t2 = new Date("2025-06-15T23:59:59Z").getTime();
    expect(bucketStart(t1, "daily")).toBe(bucketStart(t2, "daily"));
  });

  it("points on different days map to different buckets", () => {
    const t1 = new Date("2025-06-15T12:00:00Z").getTime();
    const t2 = new Date("2025-06-16T12:00:00Z").getTime();
    expect(bucketStart(t1, "daily")).not.toBe(bucketStart(t2, "daily"));
  });
});

// ── downsample ────────────────────────────────────────────────────────────────

describe("downsample", () => {
  it("returns empty array for empty input", () => {
    expect(downsample([], "daily")).toHaveLength(0);
  });

  it("computes correct min/max/avg for a single bucket", () => {
    const base = dayStart(Date.now());
    const points: TimeSeriesPoint[] = [
      makePoint("INV_1", base + 1_000, 100),
      makePoint("INV_1", base + 2_000, 200),
      makePoint("INV_1", base + 3_000, 300),
    ];
    const buckets = downsample(points, "daily");
    expect(buckets).toHaveLength(1);
    expect(buckets[0].min).toBe(100);
    expect(buckets[0].max).toBe(300);
    expect(buckets[0].avg).toBeCloseTo(200);
    expect(buckets[0].count).toBe(3);
  });

  it("produces multiple buckets for points spanning multiple days", () => {
    const day1 = dayStart(Date.now());
    const day2 = day1 + MS_PER_DAY;
    const points: TimeSeriesPoint[] = [
      makePoint("INV_2", day1 + 1_000, 50),
      makePoint("INV_2", day2 + 1_000, 150),
    ];
    const buckets = downsample(points, "daily");
    expect(buckets).toHaveLength(2);
    expect(buckets[0].bucketStartMs).toBe(day1);
    expect(buckets[1].bucketStartMs).toBe(day2);
  });

  it("preserves min/max/avg independently (no cross-bucket contamination)", () => {
    const day1 = dayStart(Date.now());
    const day2 = day1 + MS_PER_DAY;
    const points: TimeSeriesPoint[] = [
      makePoint("INV_3", day1 + 1_000, 10),
      makePoint("INV_3", day1 + 2_000, 90),
      makePoint("INV_3", day2 + 1_000, 500),
    ];
    const buckets = downsample(points, "daily");
    const b1 = buckets.find((b) => b.bucketStartMs === day1)!;
    const b2 = buckets.find((b) => b.bucketStartMs === day2)!;

    expect(b1.min).toBe(10);
    expect(b1.max).toBe(90);
    expect(b2.min).toBe(500);
    expect(b2.max).toBe(500);
  });
});

// ── TimeSeriesService — ingest + query ────────────────────────────────────────

describe("TimeSeriesService — range queries", () => {
  it("returns points within [fromMs, toMs] inclusive", async () => {
    const svc = makeService();
    const base = Date.now();

    await svc.ingestBatch([
      makePoint("INV_A", base - 1, 10),    // before range
      makePoint("INV_A", base,     20),    // boundary — included
      makePoint("INV_A", base + 1, 30),    // within range
      makePoint("INV_A", base + 2, 40),    // at upper boundary
      makePoint("INV_A", base + 3, 50),    // after range
    ]);

    const result = await svc.queryRaw({
      kind: "pool-yield",
      subject: "INV_A",
      fromMs: base,
      toMs: base + 2,
    });

    expect(result).toHaveLength(3);
    expect(result.map((p) => p.value)).toEqual([20, 30, 40]);
  });
});

// ── TimeSeriesService — backfill deduplication ────────────────────────────────

describe("TimeSeriesService — backfill deduplication", () => {
  it("inserting the same point twice does not create duplicates", async () => {
    const svc = makeService();
    const point = makePoint("INV_B", 1_000_000, 42);

    const written1 = await svc.backfill([point]);
    const written2 = await svc.backfill([point]); // exact duplicate

    expect(written1).toBe(1);
    expect(written2).toBe(0); // duplicate → 0 written

    const result = await svc.queryRaw({
      kind: "pool-yield",
      subject: "INV_B",
      fromMs: 999_999,
      toMs: 1_000_001,
    });
    expect(result).toHaveLength(1);
  });

  it("backfill triggers bucket recomputation without duplication", async () => {
    const svc = makeService();
    const base = dayStart(Date.now());

    const points = [
      makePoint("INV_C", base + 1_000, 100),
      makePoint("INV_C", base + 2_000, 200),
    ];

    await svc.backfill(points);
    // Re-backfill the same points — buckets should not double-count.
    await svc.backfill(points);

    const buckets = await svc.queryDownsampled({
      kind: "pool-yield",
      subject: "INV_C",
      fromMs: base,
      toMs: base + MS_PER_DAY,
      granularity: "daily",
    });

    expect(buckets).toHaveLength(1);
    // avg should still be 150, not 125 from counting points twice
    expect(buckets[0].avg).toBeCloseTo(150);
    expect(buckets[0].count).toBe(2);
  });
});

// ── TimeSeriesService — downsampled query fallback ────────────────────────────

describe("TimeSeriesService — on-the-fly downsampling fallback", () => {
  it("computes buckets from raw data when no pre-computed buckets exist", async () => {
    const svc = makeService();
    const base = dayStart(Date.now());

    await svc.ingestBatch([
      makePoint("INV_D", base + 1_000, 10),
      makePoint("INV_D", base + 2_000, 30),
    ]);

    // Query without triggering pre-computation (no backfill called).
    const buckets = await svc.queryDownsampled({
      kind: "pool-yield",
      subject: "INV_D",
      fromMs: base,
      toMs: base + MS_PER_DAY,
      granularity: "daily",
    });

    expect(buckets).toHaveLength(1);
    expect(buckets[0].min).toBe(10);
    expect(buckets[0].max).toBe(30);
    expect(buckets[0].avg).toBeCloseTo(20);
  });
});

// ── TimeSeriesService — retention ─────────────────────────────────────────────

describe("TimeSeriesService — retention enforcement", () => {
  it("prunes raw points older than retention window", async () => {
    const shortRetention = new TimeSeriesService(new InMemoryTimeSeriesStore(), {
      rawRetentionDays: 1,
      downsampledRetentionDays: 7,
    });

    const oldTs = Date.now() - 2 * MS_PER_DAY; // 2 days ago — beyond 1-day window
    const newTs = Date.now() - MS_PER_DAY / 2;  // 12 h ago — within window

    await shortRetention.ingestBatch([
      makePoint("INV_E", oldTs, 99),
      makePoint("INV_E", newTs, 55),
    ]);

    const pruned = await shortRetention.enforceRetention(["pool-yield"]);
    expect(pruned["pool-yield"].raw).toBe(1); // old point pruned

    const remaining = await shortRetention.queryRaw({
      kind: "pool-yield",
      subject: "INV_E",
      fromMs: 0,
      toMs: Date.now(),
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].value).toBe(55);
  });
});
