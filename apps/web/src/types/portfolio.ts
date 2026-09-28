/**
 * Type definitions for Investor Portfolio Dashboard (#775)
 */

export type PositionStatus = 'Active' | 'Completed' | 'Defaulted' | 'Transferred';

export interface InvestorPosition {
  id: string;
  poolId: string;
  invoiceId: string;
  debtorName: string;
  debtorHash: string;
  riskTier: 'AAA' | 'AA' | 'A' | 'BBB' | 'HighYield';
  currency: string;
  investedAmount: bigint;
  currentValue: bigint;
  realizedYield: bigint;
  unrealizedYield: bigint;
  fundingTimestamp: number;
  maturityTimestamp: number;
  status: PositionStatus;
}

export interface RiskTierExposure {
  riskTier: string;
  amount: bigint;
  percentage: number;
}

export interface DebtorExposure {
  debtorName: string;
  debtorHash: string;
  amount: bigint;
  percentage: number;
}

export interface PortfolioMetrics {
  totalInvestedByCurrency: Record<string, bigint>;
  totalRealizedYieldByCurrency: Record<string, bigint>;
  totalUnrealizedYieldByCurrency: Record<string, bigint>;
  activePositionsCount: number;
  historicalPositionsCount: number;
  riskTierDistribution: RiskTierExposure[];
  debtorDistribution: DebtorExposure[];
}
