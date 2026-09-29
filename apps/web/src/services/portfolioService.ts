/**
 * Service for Investor Portfolio Dashboard (#775)
 * Calculates multi-currency aggregate metrics, secondary market position transfers,
 * risk tier and debtor exposure distributions.
 */

import { InvestorPosition, PortfolioMetrics, RiskTierExposure, DebtorExposure } from '../types/portfolio';

export class PortfolioService {
  /**
   * Filters positions to active investor holdings.
   * Removes positions that have been transferred via secondary market.
   */
  public static filterActivePositions(positions: InvestorPosition[]): InvestorPosition[] {
    return positions.filter((p) => p.status === 'Active');
  }

  /**
   * Filters historical positions (Completed / Defaulted / Transferred).
   */
  public static filterHistoricalPositions(positions: InvestorPosition[]): InvestorPosition[] {
    return positions.filter((p) => p.status !== 'Active');
  }

  /**
   * Computes portfolio aggregate metrics without improperly summing across different currencies.
   */
  public static computePortfolioMetrics(positions: InvestorPosition[]): PortfolioMetrics {
    const active = this.filterActivePositions(positions);
    const historical = this.filterHistoricalPositions(positions);

    const totalInvestedByCurrency: Record<string, bigint> = {};
    const totalRealizedYieldByCurrency: Record<string, bigint> = {};
    const totalUnrealizedYieldByCurrency: Record<string, bigint> = {};

    const riskTierTotals: Record<string, bigint> = {};
    const debtorTotals: Record<string, { debtorName: string; amount: bigint }> = {};

    let grandTotalBaseUnits = 0n;

    for (const pos of active) {
      const curr = pos.currency;
      totalInvestedByCurrency[curr] = (totalInvestedByCurrency[curr] || 0n) + pos.investedAmount;
      totalRealizedYieldByCurrency[curr] = (totalRealizedYieldByCurrency[curr] || 0n) + pos.realizedYield;
      totalUnrealizedYieldByCurrency[curr] = (totalUnrealizedYieldByCurrency[curr] || 0n) + pos.unrealizedYield;

      grandTotalBaseUnits += pos.investedAmount;

      // Risk Tier breakdown
      riskTierTotals[pos.riskTier] = (riskTierTotals[pos.riskTier] || 0n) + pos.investedAmount;

      // Debtor breakdown
      if (!debtorTotals[pos.debtorHash]) {
        debtorTotals[pos.debtorHash] = { debtorName: pos.debtorName, amount: 0n };
      }
      debtorTotals[pos.debtorHash].amount += pos.investedAmount;
    }

    // Historical realized yield aggregation
    for (const pos of historical) {
      const curr = pos.currency;
      totalRealizedYieldByCurrency[curr] = (totalRealizedYieldByCurrency[curr] || 0n) + pos.realizedYield;
    }

    // Calculate percentages
    const riskTierDistribution: RiskTierExposure[] = Object.entries(riskTierTotals).map(([riskTier, amount]) => ({
      riskTier,
      amount,
      percentage: grandTotalBaseUnits > 0n ? Number((amount * 10000n) / grandTotalBaseUnits) / 100 : 0,
    }));

    const debtorDistribution: DebtorExposure[] = Object.entries(debtorTotals).map(([debtorHash, info]) => ({
      debtorName: info.debtorName,
      debtorHash,
      amount: info.amount,
      percentage: grandTotalBaseUnits > 0n ? Number((info.amount * 10000n) / grandTotalBaseUnits) / 100 : 0,
    }));

    return {
      totalInvestedByCurrency,
      totalRealizedYieldByCurrency,
      totalUnrealizedYieldByCurrency,
      activePositionsCount: active.length,
      historicalPositionsCount: historical.length,
      riskTierDistribution,
      debtorDistribution,
    };
  }

  /**
   * Simulates transferring ownership of a position on the secondary market.
   * Updates position status to 'Transferred'.
   */
  public static transferPositionOnSecondaryMarket(
    positions: InvestorPosition[],
    positionId: string,
  ): InvestorPosition[] {
    return positions.map((p) => (p.id === positionId ? { ...p, status: 'Transferred' as const } : p));
  }
}
