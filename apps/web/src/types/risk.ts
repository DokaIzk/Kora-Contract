export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskStatus = 'ACTIVE' | 'UNDER_REVIEW' | 'DISPUTED';

export interface RiskFactor {
  id: string;
  name: string;
  category: 'FINANCIAL' | 'REPAYMENT_HISTORY' | 'CONCENTRATION' | 'INDUSTRY' | 'TENOR';
  score: number; // 0 - 100
  weightPercentage: number; // e.g. 30 for 30%
  description: string;
}

export interface RiskBreakdown {
  invoiceId: string;
  compositeScore: number; // 0 - 100
  tier: RiskTier;
  status: RiskStatus;
  confidencePercentage: number; // e.g. 92%
  verifierCount: number;
  factors: RiskFactor[];
  lastUpdated: string;
  disputeNotice?: string;
}
