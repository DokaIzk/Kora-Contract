import { DiversificationData, ExposureItem, RiskTier, TenorBucket } from '../types/diversification';

export class DiversificationService {
  // Protocol concentration caps: Max 30% per debtor, 40% per risk tier, 50% per tenor
  private DEBTOR_CAP_PERCENT = 30;
  private RISK_TIER_CAP_PERCENT = 40;
  private TENOR_CAP_PERCENT = 50;

  public calculateDiversification(
    positions: Array<{ debtor: string; amountUsd: number; riskScore: number; tenorDays: number }>
  ): DiversificationData {
    const totalPortfolioUsd = positions.reduce((sum, p) => sum + p.amountUsd, 0);

    if (totalPortfolioUsd === 0) {
      return {
        totalPortfolioUsd: 0,
        riskTierExposure: {
          LOW: this.createEmptyExposure('LOW', 'Low Risk (Score <= 40)', this.RISK_TIER_CAP_PERCENT),
          MEDIUM: this.createEmptyExposure('MEDIUM', 'Medium Risk (Score 41-70)', this.RISK_TIER_CAP_PERCENT),
          HIGH: this.createEmptyExposure('HIGH', 'High Risk (Score 71-100)', this.RISK_TIER_CAP_PERCENT),
        },
        debtorExposures: [],
        tenorExposures: {
          '30_DAYS': this.createEmptyExposure('30_DAYS', '30 Days', this.TENOR_CAP_PERCENT),
          '60_DAYS': this.createEmptyExposure('60_DAYS', '60 Days', this.TENOR_CAP_PERCENT),
          '90_DAYS': this.createEmptyExposure('90_DAYS', '90 Days', this.TENOR_CAP_PERCENT),
        },
        warnings: [],
      };
    }

    // Risk tier grouping
    const riskTierTotals: Record<RiskTier, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    const debtorTotals: Record<string, number> = {};
    const tenorTotals: Record<TenorBucket, number> = { '30_DAYS': 0, '60_DAYS': 0, '90_DAYS': 0 };

    positions.forEach((p) => {
      // Risk tier
      if (p.riskScore <= 40) riskTierTotals.LOW += p.amountUsd;
      else if (p.riskScore <= 70) riskTierTotals.MEDIUM += p.amountUsd;
      else riskTierTotals.HIGH += p.amountUsd;

      // Debtor
      debtorTotals[p.debtor] = (debtorTotals[p.debtor] || 0) + p.amountUsd;

      // Tenor
      if (p.tenorDays <= 30) tenorTotals['30_DAYS'] += p.amountUsd;
      else if (p.tenorDays <= 60) tenorTotals['60_DAYS'] += p.amountUsd;
      else tenorTotals['90_DAYS'] += p.amountUsd;
    });

    const warnings: string[] = [];

    // Build risk tier exposure
    const riskTierExposure: Record<RiskTier, ExposureItem> = {
      LOW: this.buildExposureItem('LOW', 'Low Risk (Score <= 40)', riskTierTotals.LOW, totalPortfolioUsd, this.RISK_TIER_CAP_PERCENT, warnings),
      MEDIUM: this.buildExposureItem('MEDIUM', 'Medium Risk (Score 41-70)', riskTierTotals.MEDIUM, totalPortfolioUsd, this.RISK_TIER_CAP_PERCENT, warnings),
      HIGH: this.buildExposureItem('HIGH', 'High Risk (Score 71-100)', riskTierTotals.HIGH, totalPortfolioUsd, this.RISK_TIER_CAP_PERCENT, warnings),
    };

    // Build debtor exposures
    const debtorExposures: ExposureItem[] = Object.keys(debtorTotals).map((debtor) =>
      this.buildExposureItem(debtor, debtor, debtorTotals[debtor], totalPortfolioUsd, this.DEBTOR_CAP_PERCENT, warnings)
    );

    // Build tenor exposures
    const tenorExposures: Record<TenorBucket, ExposureItem> = {
      '30_DAYS': this.buildExposureItem('30_DAYS', '30 Days', tenorTotals['30_DAYS'], totalPortfolioUsd, this.TENOR_CAP_PERCENT, warnings),
      '60_DAYS': this.buildExposureItem('60_DAYS', '60 Days', tenorTotals['60_DAYS'], totalPortfolioUsd, this.TENOR_CAP_PERCENT, warnings),
      '90_DAYS': this.buildExposureItem('90_DAYS', '90 Days', tenorTotals['90_DAYS'], totalPortfolioUsd, this.TENOR_CAP_PERCENT, warnings),
    };

    return {
      totalPortfolioUsd,
      riskTierExposure,
      debtorExposures,
      tenorExposures,
      warnings,
    };
  }

  public checkProspectiveContribution(
    currentPositions: Array<{ debtor: string; amountUsd: number; riskScore: number; tenorDays: number }>,
    prospective: { debtor: string; amountUsd: number; riskScore: number; tenorDays: number }
  ): { willBreach: boolean; reason?: string; projectedPercent: number } {
    const updatedPositions = [...currentPositions, prospective];
    const newDiversification = this.calculateDiversification(updatedPositions);

    const prospectiveDebtorItem = newDiversification.debtorExposures.find((d) => d.name === prospective.debtor);
    if (prospectiveDebtorItem && prospectiveDebtorItem.status === 'BREACHED') {
      return {
        willBreach: true,
        reason: `Contribution breaches Debtor Concentration Cap (${prospectiveDebtorItem.percentage.toFixed(1)}% vs max ${this.DEBTOR_CAP_PERCENT}%).`,
        projectedPercent: prospectiveDebtorItem.percentage,
      };
    }

    return {
      willBreach: false,
      projectedPercent: prospectiveDebtorItem ? prospectiveDebtorItem.percentage : 0,
    };
  }

  private buildExposureItem(
    key: string,
    name: string,
    amountUsd: number,
    totalPortfolioUsd: number,
    capPercent: number,
    warnings: string[]
  ): ExposureItem {
    const percentage = totalPortfolioUsd > 0 ? (amountUsd / totalPortfolioUsd) * 100 : 0;
    let status: 'SAFE' | 'WARNING' | 'BREACHED' = 'SAFE';

    if (percentage > capPercent) {
      status = 'BREACHED';
      warnings.push(`Exposure to ${name} (${percentage.toFixed(1)}%) breaches the concentration cap (${capPercent}%).`);
    } else if (percentage >= capPercent * 0.8) {
      status = 'WARNING';
      warnings.push(`Exposure to ${name} (${percentage.toFixed(1)}%) is approaching the concentration cap (${capPercent}%).`);
    }

    return { key, name, amountUsd, percentage, capPercent, status };
  }

  private createEmptyExposure(key: string, name: string, capPercent: number): ExposureItem {
    return { key, name, amountUsd: 0, percentage: 0, capPercent, status: 'SAFE' };
  }
}

export const diversificationService = new DiversificationService();
