export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type TenorBucket = '30_DAYS' | '60_DAYS' | '90_DAYS';

export interface ConcentrationCapInfo {
  maxPercent: number; // e.g. 25% max exposure to single debtor
  currentPercent: number;
  currentAmountUsd: number;
  maxAmountUsd: number;
  status: 'SAFE' | 'WARNING' | 'BREACHED';
}

export interface ExposureItem {
  key: string;
  name: string;
  amountUsd: number;
  percentage: number;
  capPercent: number;
  status: 'SAFE' | 'WARNING' | 'BREACHED';
}

export interface DiversificationData {
  totalPortfolioUsd: number;
  riskTierExposure: Record<RiskTier, ExposureItem>;
  debtorExposures: ExposureItem[];
  tenorExposures: Record<TenorBucket, ExposureItem>;
  warnings: string[];
}
