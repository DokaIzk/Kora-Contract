import { ConcentrationCapCheck, FeeBreakdown, ListingFundingState, YieldPreview } from '../types/funding';

export class FundingService {
  private readonly DEFAULT_PLATFORM_FEE_PCT = 0.5; // 0.5% fee

  /**
   * Calculates fee breakdown for a contribution
   */
  public calculateFeeBreakdown(grossAmountUsd: number, platformFeePercentage = this.DEFAULT_PLATFORM_FEE_PCT): FeeBreakdown {
    const platformFeeUsd = Math.round((grossAmountUsd * (platformFeePercentage / 100)) * 100) / 100;
    const netContributionUsd = Math.max(0, grossAmountUsd - platformFeeUsd);
    return {
      grossAmountUsd,
      platformFeePercentage,
      platformFeeUsd,
      netContributionUsd,
    };
  }

  /**
   * Computes client-side expected yield preview matching on-chain smart contract formulas
   */
  public calculateYieldPreview(
    contributionAmountUsd: number,
    annualYieldPercentage: number,
    tenorDays: number,
    platformFeePercentage = this.DEFAULT_PLATFORM_FEE_PCT
  ): YieldPreview {
    const feeInfo = this.calculateFeeBreakdown(contributionAmountUsd, platformFeePercentage);

    // Interest = Principal * (Annual Rate / 100) * (Tenor / 365)
    const expectedGrossYieldUsd = Math.round((contributionAmountUsd * (annualYieldPercentage / 100) * (tenorDays / 365)) * 100) / 100;
    const expectedNetYieldUsd = Math.max(0, Math.round((expectedGrossYieldUsd - feeInfo.platformFeeUsd) * 100) / 100);
    const estimatedReturnOnInvestmentPct = contributionAmountUsd > 0
      ? Math.round(((expectedNetYieldUsd / contributionAmountUsd) * 100) * 100) / 100
      : 0;

    return {
      contributionAmountUsd,
      annualYieldPercentage,
      tenorDays,
      expectedGrossYieldUsd,
      platformFeeUsd: feeInfo.platformFeeUsd,
      expectedNetYieldUsd,
      estimatedReturnOnInvestmentPct,
    };
  }

  /**
   * Validates if a proposed contribution breaches concentration caps before on-chain signature
   */
  public checkConcentrationCap(
    debtorName: string,
    currentExposureUsd: number,
    proposedContributionUsd: number,
    maxCapUsd: number,
    totalPortfolioUsd: number
  ): ConcentrationCapCheck {
    const projectedExposure = currentExposureUsd + proposedContributionUsd;
    const newTotalPortfolio = totalPortfolioUsd + proposedContributionUsd;

    const currentPercentage = totalPortfolioUsd > 0 ? (currentExposureUsd / totalPortfolioUsd) * 100 : 0;
    const projectedPercentage = newTotalPortfolio > 0 ? (projectedExposure / newTotalPortfolio) * 100 : 0;

    const willBreach = projectedExposure > maxCapUsd;
    const breachReason = willBreach
      ? `Contribution of $${proposedContributionUsd.toLocaleString()} would bring total debtor exposure for ${debtorName} to $${projectedExposure.toLocaleString()}, exceeding the maximum limit of $${maxCapUsd.toLocaleString()}`
      : undefined;

    return {
      debtorName,
      currentExposureUsd,
      proposedContributionUsd,
      maxCapUsd,
      currentPercentage: Math.round(currentPercentage * 10) / 10,
      projectedPercentage: Math.round(projectedPercentage * 10) / 10,
      willBreach,
      breachReason,
    };
  }

  /**
   * Mock listing fetcher
   */
  public getListingState(listingId: number): ListingFundingState {
    return {
      listingId,
      invoiceId: `INV-2026-${listingId}`,
      debtorName: 'Acme Global Logistics',
      targetFundingUsd: 50000,
      currentFundingUsd: 32000,
      remainingFundingUsd: 18000,
      minContributionUsd: 100,
      maxConcentrationCapUsd: 25000,
      tenorDays: 60,
      annualYieldPercentage: 14.5,
      isFullyFunded: false,
    };
  }
}

export const fundingService = new FundingService();
