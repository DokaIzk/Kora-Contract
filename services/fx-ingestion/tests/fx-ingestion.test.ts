/**
 * FX Ingestion Service — Test Suite
 *
 * Covers:
 *  - Source divergence rejection (sources disagree beyond threshold)
 *  - Missing-data skip (all sources unavailable — nothing published)
 *  - Single-source skip (cannot cross-check with one source)
 *  - Consensus rate computation (mean of passing sources)
 *  - Staleness-guard interaction (oracle relay refuses stale rates)
 *  - Rate-limit enforcement (no double-publish within same cycle)
 *  - Full engine cycle: pairs processed, failures isolated
 *
 * Issue #766 — Minimum 90% coverage.
 */

import { CrossChecker } from "../src/crosscheck";
import { OracleRelay, PublishResult } from "../src/relay";
import { IngestionEngine } from "../src/engine";
import { FxSource } from "../src/sources";
import { CurrencyCode, FxQuote, FxIngestionConfig } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuote(
  source: string,
  base: CurrencyCode,
  quote: CurrencyCode,
  rate: number,
  fetchedAt?: number
): FxQuote {
  return {
    source,
    base,
    quote,
    rateScaled: BigInt(Math.round(rate * 10_000_000)),
    fetchedAt: fetchedAt ?? Math.floor(Date.now() / 1000),
  };
}

/** A test FxSource that returns a pre-configured response. */
class StubSource implements FxSource {
  constructor(
    readonly name: string,
    private readonly response: FxQuote | null
  ) {}

  async fetchRate(_base: CurrencyCode, _quote: CurrencyCode): Promise<FxQuote | null> {
    return this.response;
  }
}

/** A test OracleRelay subclass that captures publish calls. */
class MockRelay extends OracleRelay {
  published: Array<{
    base: CurrencyCode;
    quote: CurrencyCode;
    rateScaled: bigint;
    fetchedAt: number;
  }> = [];

  protected override async _submitToOracle(
    base: CurrencyCode,
    quote: CurrencyCode,
    rateScaled: bigint,
    fetchedAt: number
  ): Promise<string> {
    this.published.push({ base, quote, rateScaled, fetchedAt });
    return "0xmocktxhash";
  }
}

const BASE_CONFIG: FxIngestionConfig = {
  currencies: ["NGN", "KES"],
  quoteCurrency: "USDC",
  maxDivergenceBps: 200,
  pollIntervalMs: 300_000,
  oracleContractAddress: "CORACLE",
  relaySecret: "SRELAY",
  rpcUrl: "https://test",
  networkPassphrase: "Test SDF Network ; September 2015",
  maxStalenessSeconds: 3600,
};

// ---------------------------------------------------------------------------
// CrossChecker tests
// ---------------------------------------------------------------------------

describe("CrossChecker", () => {
  test("throws if fewer than 2 sources are provided", () => {
    const src = new StubSource("a", makeQuote("a", "NGN", "USDC", 0.00065));
    expect(() => new CrossChecker([src], 200)).toThrow("at least 2");
  });

  test("passes when sources agree within threshold", async () => {
    const src1 = new StubSource("a", makeQuote("a", "NGN", "USDC", 0.00065));
    const src2 = new StubSource("b", makeQuote("b", "NGN", "USDC", 0.000652));
    const checker = new CrossChecker([src1, src2], 200);
    const result = await checker.check("NGN", "USDC");
    expect(result.passed).toBe(true);
    expect(result.consensusRate).toBeDefined();
  });

  test("rejects when sources diverge beyond threshold", async () => {
    // 0.00065 vs 0.0009 — large divergence
    const src1 = new StubSource("a", makeQuote("a", "NGN", "USDC", 0.00065));
    const src2 = new StubSource("b", makeQuote("b", "NGN", "USDC", 0.0009));
    const checker = new CrossChecker([src1, src2], 200);
    const result = await checker.check("NGN", "USDC");
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/divergence/);
  });

  test("skips publication when all sources are unavailable", async () => {
    const src1 = new StubSource("a", null);
    const src2 = new StubSource("b", null);
    const checker = new CrossChecker([src1, src2], 200);
    const result = await checker.check("NGN", "USDC");
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("no_sources_available");
    expect(result.consensusRate).toBeUndefined();
  });

  test("skips publication when only one source is available (cannot cross-check)", async () => {
    const src1 = new StubSource("a", makeQuote("a", "NGN", "USDC", 0.00065));
    const src2 = new StubSource("b", null); // unavailable
    const checker = new CrossChecker([src1, src2], 200);
    const result = await checker.check("NGN", "USDC");
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("insufficient_sources_for_cross_check");
  });

  test("consensus rate is the arithmetic mean of two sources", async () => {
    const rate1 = 6500n; // scaled by 1e7 * 1e-7 = 0.0006500
    const rate2 = 6600n;
    const q1: FxQuote = { source: "a", base: "NGN", quote: "USDC", rateScaled: rate1, fetchedAt: 0 };
    const q2: FxQuote = { source: "b", base: "NGN", quote: "USDC", rateScaled: rate2, fetchedAt: 0 };
    // Use tiny rates to keep divergence manageable
    const src1: FxSource = { name: "a", fetchRate: async () => q1 };
    const src2: FxSource = { name: "b", fetchRate: async () => q2 };
    const checker = new CrossChecker([src1, src2], 5000); // wide threshold
    const result = await checker.check("NGN", "USDC");
    expect(result.passed).toBe(true);
    // mean of 6500 and 6600 = 6550
    expect(result.consensusRate).toBe(6550n);
  });
});

// ---------------------------------------------------------------------------
// OracleRelay tests
// ---------------------------------------------------------------------------

describe("OracleRelay", () => {
  function makeRelay(overrides: Partial<FxIngestionConfig> = {}): MockRelay {
    return new MockRelay({ ...BASE_CONFIG, ...overrides });
  }

  test("publishes a fresh rate successfully", async () => {
    const relay = makeRelay();
    const result = await relay.publish("NGN", "USDC", 6500n, Math.floor(Date.now() / 1000));
    expect(result.skipped).toBe(false);
    expect(result.txHash).toBe("0xmocktxhash");
    expect(relay.published).toHaveLength(1);
  });

  test("staleness-guard: skips rate that is too old", async () => {
    const relay = makeRelay({ maxStalenessSeconds: 60 });
    const staleTs = Math.floor(Date.now() / 1000) - 120; // 2 minutes old
    const result = await relay.publish("NGN", "USDC", 6500n, staleTs);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("stale_rate");
    expect(relay.published).toHaveLength(0);
  });

  test("rate-limit: double-publish in same cycle is skipped", async () => {
    const relay = makeRelay({ pollIntervalMs: 300_000 }); // 5-min cycle
    const now = Math.floor(Date.now() / 1000);
    // First publish succeeds
    await relay.publish("NGN", "USDC", 6500n, now);
    // Second publish within same cycle is rate-limited
    const result = await relay.publish("NGN", "USDC", 6500n, now);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("rate_limited");
    expect(relay.published).toHaveLength(1);
  });

  test("different pairs are not rate-limited against each other", async () => {
    const relay = makeRelay();
    const now = Math.floor(Date.now() / 1000);
    await relay.publish("NGN", "USDC", 6500n, now);
    const result = await relay.publish("KES", "USDC", 131n, now);
    expect(result.skipped).toBe(false);
    expect(relay.published).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// IngestionEngine integration tests
// ---------------------------------------------------------------------------

describe("IngestionEngine", () => {
  test("full cycle: passes cross-check → publishes to oracle", async () => {
    const src1 = new StubSource("a", makeQuote("a", "NGN", "USDC", 0.00065));
    const src2 = new StubSource("b", makeQuote("b", "NGN", "USDC", 0.000651));
    const checker = new CrossChecker([src1, src2], 200);
    const relay = new MockRelay(BASE_CONFIG);
    const engine = new IngestionEngine(checker, relay, {
      ...BASE_CONFIG,
      currencies: ["NGN"],
    });

    await engine.runCycle();
    expect(relay.published).toHaveLength(1);
    expect(relay.published[0].base).toBe("NGN");
  });

  test("failed cross-check: nothing published to oracle", async () => {
    // Both sources unavailable
    const src1 = new StubSource("a", null);
    const src2 = new StubSource("b", null);
    const checker = new CrossChecker([src1, src2], 200);
    const relay = new MockRelay(BASE_CONFIG);
    const engine = new IngestionEngine(checker, relay, {
      ...BASE_CONFIG,
      currencies: ["NGN"],
    });

    await engine.runCycle();
    expect(relay.published).toHaveLength(0);
  });

  test("one pair failing does not block others", async () => {
    // NGN fails, KES passes
    const ngnFail: FxSource = { name: "a", fetchRate: async (_b, q) => q === "USDC" ? null : null };
    const kesSrc1 = new StubSource("a", makeQuote("a", "KES", "USDC", 0.0077));
    const kesSrc2 = new StubSource("b", makeQuote("b", "KES", "USDC", 0.00771));

    // We need separate checkers per currency — the engine uses one shared checker,
    // but we verify the engine's allSettled behaviour isolates failures.
    const allAvailSrc1: FxSource = {
      name: "src1",
      fetchRate: async (base, _quote) => {
        if (base === "KES") return makeQuote("src1", "KES", "USDC", 0.0077);
        return null; // NGN unavailable
      },
    };
    const allAvailSrc2: FxSource = {
      name: "src2",
      fetchRate: async (base, _quote) => {
        if (base === "KES") return makeQuote("src2", "KES", "USDC", 0.00771);
        return null; // NGN unavailable
      },
    };

    const checker = new CrossChecker([allAvailSrc1, allAvailSrc2], 200);
    const relay = new MockRelay(BASE_CONFIG);
    const engine = new IngestionEngine(checker, relay, {
      ...BASE_CONFIG,
      currencies: ["NGN", "KES"],
    });

    await engine.runCycle();
    // Only KES should have been published
    expect(relay.published.some((p) => p.base === "KES")).toBe(true);
    expect(relay.published.some((p) => p.base === "NGN")).toBe(false);
  });
});
