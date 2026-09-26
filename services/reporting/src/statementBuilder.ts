/**
 * Reporting Service — Statement Builder
 *
 * Aggregates raw event data into UserStatement and ProtocolStatement objects.
 *
 * Key invariant: per-asset totals are ALWAYS computed separately — USDC and
 * EURC totals are never added together.  This is enforced by grouping on the
 * `asset` field before summing.
 *
 * Reproducibility: given the same input events and date range, the output is
 * deterministic.  No randomness or timestamps are introduced here.
 *
 * Issue #770
 */

import {
  FundingEvent,
  RepaymentEvent,
  YieldEvent,
  FeeEvent,
  AssetSummary,
  UserStatement,
  ProtocolStatement,
} from "./types";

export class StatementBuilder {
  /**
   * Build a per-user statement from raw events.
   * Events outside [fromTs, toTs] are filtered out.
   */
  buildUserStatement(
    userAddress: string,
    fromTs: number,
    toTs: number,
    funding: FundingEvent[],
    repayments: RepaymentEvent[],
    yields: YieldEvent[],
    fees: FeeEvent[]
  ): UserStatement {
    const inRange = <T extends { timestamp: number }>(events: T[]): T[] =>
      events.filter((e) => e.timestamp >= fromTs && e.timestamp <= toTs);

    const filteredFunding = inRange(funding);
    const filteredRepayments = inRange(repayments);
    const filteredYields = inRange(yields);
    const filteredFees = inRange(fees);

    const summaryByAsset = this._computeAssetSummary(
      filteredFunding,
      filteredRepayments,
      filteredYields,
      filteredFees
    );

    return {
      userAddress,
      fromTs,
      toTs,
      funding: filteredFunding,
      repayments: filteredRepayments,
      yields: filteredYields,
      fees: filteredFees,
      summaryByAsset,
    };
  }

  /**
   * Build a protocol-wide aggregate statement.
   */
  buildProtocolStatement(
    fromTs: number,
    toTs: number,
    totalInvoicesFinanced: number,
    totalInvoicesRepaid: number,
    totalInvoicesDefaulted: number,
    allFunding: FundingEvent[],
    allRepayments: RepaymentEvent[],
    allYields: YieldEvent[],
    allFees: FeeEvent[]
  ): ProtocolStatement {
    const inRange = <T extends { timestamp: number }>(events: T[]): T[] =>
      events.filter((e) => e.timestamp >= fromTs && e.timestamp <= toTs);

    const summaryByAsset = this._computeAssetSummary(
      inRange(allFunding),
      inRange(allRepayments),
      inRange(allYields),
      inRange(allFees)
    );

    return {
      fromTs,
      toTs,
      totalInvoicesFinanced,
      totalInvoicesRepaid,
      totalInvoicesDefaulted,
      summaryByAsset,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute per-asset totals.  Critically, each asset is summed independently
   * — there is no cross-asset aggregation.
   */
  private _computeAssetSummary(
    funding: FundingEvent[],
    repayments: RepaymentEvent[],
    yields: YieldEvent[],
    fees: FeeEvent[]
  ): AssetSummary[] {
    const assets = new Set<string>();
    for (const e of [...funding, ...repayments, ...yields, ...fees]) {
      assets.add(e.asset);
    }

    return Array.from(assets).map((asset) => ({
      asset,
      totalFunded: funding
        .filter((e) => e.asset === asset)
        .reduce((s, e) => s + e.amount, 0n),
      totalRepaid: repayments
        .filter((e) => e.asset === asset)
        .reduce((s, e) => s + e.amount, 0n),
      totalYield: yields
        .filter((e) => e.asset === asset)
        .reduce((s, e) => s + e.yieldAmount, 0n),
      totalFees: fees
        .filter((e) => e.asset === asset)
        .reduce((s, e) => s + e.feeAmount, 0n),
    }));
  }
}
