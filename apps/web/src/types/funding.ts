export type FundingStep = 'AMOUNT_SELECTION' | 'YIELD_PREVIEW' | 'SIMULATION_AND_SIGN';

export interface FeeBreakdown {
  grossAmountUsd: number;
  platformFeePercentage: number;
  platformFeeUsd: number;
  netContributionUsd: number;
}

export interface YieldPreview {
  contributionAmountUsd: number;
  annualYieldPercentage: number;
  tenorDays: number;
  expectedGrossYieldUsd: number;
  platformFeeUsd: number;
  expectedNetYieldUsd: number;
  estimatedReturnOnInvestmentPct: number;
}

export interface ConcentrationCapCheck {
  debtorName: string;
  currentExposureUsd: number;
  proposedContributionUsd: number;
  maxCapUsd: number;
  currentPercentage: number;
  projectedPercentage: number;
  willBreach: boolean;
  breachReason?: string;
}

export interface ListingFundingState {
  listingId: number;
  invoiceId: string;
  debtorName: string;
  targetFundingUsd: number;
  currentFundingUsd: number;
  remainingFundingUsd: number;
  minContributionUsd: number;
  maxConcentrationCapUsd: number;
  tenorDays: number;
  annualYieldPercentage: number;
  isFullyFunded: boolean;
}
