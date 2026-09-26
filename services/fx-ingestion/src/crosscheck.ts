/**
 * FX Ingestion Service — Cross-Checker
 *
 * Fetches the same rate from N independent sources and rejects publication
 * if sources diverge beyond `maxDivergenceBps`.
 *
 * Divergence is measured as:
 *   (max_rate - min_rate) / min_rate * 10_000 (basis points)
 *
 * If ALL sources are unavailable for a pair, the pair is skipped — a stale
 * or guessed value is NEVER published.
 *
 * Issue #766
 */

import { FxSource } from "./sources";
import { CurrencyCode, CrossCheckResult, FxQuote } from "./types";
import pino from "pino";

const logger = pino({ name: "fx-ingestion:crosscheck" });

export class CrossChecker {
  constructor(
    private readonly sources: FxSource[],
    private readonly maxDivergenceBps: number
  ) {
    if (sources.length < 2) {
      throw new Error("CrossChecker requires at least 2 independent FX sources");
    }
  }

  /**
   * Fetch and cross-check the rate for `base`/`quote`.
   */
  async check(base: CurrencyCode, quote: CurrencyCode): Promise<CrossCheckResult> {
    // Fetch from all sources concurrently
    const results = await Promise.allSettled(
      this.sources.map((s) => s.fetchRate(base, quote))
    );

    const quotes: FxQuote[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null) {
        quotes.push(r.value);
      }
    }

    // No data available from any source — skip, don't guess
    if (quotes.length === 0) {
      logger.warn({ base, quote }, "All FX sources unavailable — skipping publication");
      return {
        base,
        quote,
        passed: false,
        divergenceBps: 0,
        quotes,
        reason: "no_sources_available",
      };
    }

    // Only one source available — insufficient for cross-check
    if (quotes.length === 1) {
      logger.warn(
        { base, quote, source: quotes[0].source },
        "Only one FX source available — skipping publication (cannot cross-check)"
      );
      return {
        base,
        quote,
        passed: false,
        divergenceBps: 0,
        quotes,
        reason: "insufficient_sources_for_cross_check",
      };
    }

    // Cross-check: compute divergence
    const rates = quotes.map((q) => q.rateScaled);
    const minRate = rates.reduce((a, b) => (a < b ? a : b));
    const maxRate = rates.reduce((a, b) => (a > b ? a : b));

    const divergenceBps = Number(((maxRate - minRate) * 10_000n) / minRate);

    if (divergenceBps > this.maxDivergenceBps) {
      logger.warn(
        { base, quote, divergenceBps, maxDivergenceBps: this.maxDivergenceBps, rates: rates.map(String) },
        "FX source divergence exceeds threshold — rejecting publication"
      );
      return {
        base,
        quote,
        passed: false,
        divergenceBps,
        quotes,
        reason: `source_divergence_${divergenceBps}bps_exceeds_${this.maxDivergenceBps}bps`,
      };
    }

    // Compute arithmetic mean of all available rates as the consensus
    const sum = rates.reduce((a, b) => a + b, 0n);
    const consensusRate = sum / BigInt(quotes.length);

    logger.info(
      { base, quote, divergenceBps, consensusRate: consensusRate.toString() },
      "FX cross-check passed"
    );

    return {
      base,
      quote,
      consensusRate,
      passed: true,
      divergenceBps,
      quotes,
    };
  }
}
