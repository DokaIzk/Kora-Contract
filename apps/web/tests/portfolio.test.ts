/**
 * Tests for Investor Portfolio Dashboard (#775)
 */

import { PortfolioService } from '../src/services/portfolioService';
import { InvestorPosition } from '../src/types/portfolio';

describe('Investor Portfolio Dashboard Tests (#775)', () => {
  const samplePositions: InvestorPosition[] = [
    {
      id: 'P1',
      poolId: 'POOL-A',
      invoiceId: 'INV-1',
      debtorName: 'Debtor One',
      debtorHash: '0x111',
      riskTier: 'AAA',
      currency: 'USDC',
      investedAmount: 100_000_000n,
      currentValue: 105_000_000n,
      realizedYield: 0n,
      unrealizedYield: 5_000_000n,
      fundingTimestamp: 1000,
      maturityTimestamp: 2000,
      status: 'Active',
    },
    {
      id: 'P2',
      poolId: 'POOL-B',
      invoiceId: 'INV-2',
      debtorName: 'Debtor Two',
      debtorHash: '0x222',
      riskTier: 'A',
      currency: 'USDC',
      investedAmount: 100_000_000n,
      currentValue: 102_000_000n,
      realizedYield: 0n,
      unrealizedYield: 2_000_000n,
      fundingTimestamp: 1000,
      maturityTimestamp: 2000,
      status: 'Active',
    },
    {
      id: 'P3',
      poolId: 'POOL-A',
      invoiceId: 'INV-3',
      debtorName: 'Debtor One',
      debtorHash: '0x111',
      riskTier: 'AAA',
      currency: 'EURC',
      investedAmount: 50_000_000n,
      currentValue: 50_000_000n,
      realizedYield: 4_000_000n,
      unrealizedYield: 0n,
      fundingTimestamp: 500,
      maturityTimestamp: 900,
      status: 'Completed',
    },
  ];

  it('filters active vs historical positions correctly', () => {
    const active = PortfolioService.filterActivePositions(samplePositions);
    expect(active.length).toBe(2);
    expect(active.every((p) => p.status === 'Active')).toBe(true);

    const historical = PortfolioService.filterHistoricalPositions(samplePositions);
    expect(historical.length).toBe(1);
    expect(historical[0].id).toBe('P3');
  });

  it('computes multi-currency metrics without improper currency summing', () => {
    const metrics = PortfolioService.computePortfolioMetrics(samplePositions);
    expect(metrics.totalInvestedByCurrency['USDC']).toBe(200_000_000n);
    expect(metrics.totalInvestedByCurrency['EURC']).toBeUndefined(); // EURC position is completed
    expect(metrics.totalRealizedYieldByCurrency['EURC']).toBe(4_000_000n);
    expect(metrics.activePositionsCount).toBe(2);
  });

  it('handles secondary market position transfers correctly', () => {
    const updated = PortfolioService.transferPositionOnSecondaryMarket(samplePositions, 'P1');
    const transferred = updated.find((p) => p.id === 'P1');
    expect(transferred?.status).toBe('Transferred');

    const activeAfterTransfer = PortfolioService.filterActivePositions(updated);
    expect(activeAfterTransfer.length).toBe(1);
    expect(activeAfterTransfer[0].id).toBe('P2');
  });
});
