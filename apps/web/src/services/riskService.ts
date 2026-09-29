import { RiskBreakdown, RiskTier } from '../types/risk';

export class RiskService {
  /**
   * Helper to compute the composite risk tier based on numeric score (0 - 100)
   */
  public getRiskTier(score: number): RiskTier {
    if (score <= 30) return 'LOW';
    if (score <= 60) return 'MEDIUM';
    if (score <= 85) return 'HIGH';
    return 'CRITICAL';
  }

  /**
   * Gets accessible color and icon metadata for a given risk tier
   */
  public getRiskTierMetadata(tier: RiskTier) {
    switch (tier) {
      case 'LOW':
        return {
          label: 'Low Risk',
          badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
          icon: '✓',
          ariaLabel: 'Low risk tier score',
        };
      case 'MEDIUM':
        return {
          label: 'Medium Risk',
          badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
          icon: '▲',
          ariaLabel: 'Medium risk tier score',
        };
      case 'HIGH':
        return {
          label: 'High Risk',
          badgeClass: 'bg-orange-100 text-orange-800 border-orange-300',
          icon: '⚠️',
          ariaLabel: 'High risk tier score',
        };
      case 'CRITICAL':
        return {
          label: 'Critical Risk',
          badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
          icon: '⛔',
          ariaLabel: 'Critical risk tier score',
        };
    }
  }

  /**
   * Mock fetcher for invoice risk breakdown
   */
  public getRiskBreakdown(invoiceId: string, options?: { isUnderReview?: boolean }): RiskBreakdown {
    const isUnderReview = options?.isUnderReview ?? false;

    return {
      invoiceId,
      compositeScore: 28,
      tier: 'LOW',
      status: isUnderReview ? 'UNDER_REVIEW' : 'ACTIVE',
      confidencePercentage: 94,
      verifierCount: 5,
      lastUpdated: new Date().toISOString(),
      disputeNotice: isUnderReview ? 'Invoice is under verification review due to a pending data audit dispute.' : undefined,
      factors: [
        {
          id: 'f1',
          name: 'Debtor Financial Health',
          category: 'FINANCIAL',
          score: 20,
          weightPercentage: 35,
          description: 'Strong cashflow and audited financial balance sheet.',
        },
        {
          id: 'f2',
          name: 'Historical Repayment Track Record',
          category: 'REPAYMENT_HISTORY',
          score: 15,
          weightPercentage: 25,
          description: '100% on-time repayment history across 14 past invoices.',
        },
        {
          id: 'f3',
          name: 'Portfolio Concentration Impact',
          category: 'CONCENTRATION',
          score: 35,
          weightPercentage: 20,
          description: 'Debtor exposure represents 12% of pool capacity.',
        },
        {
          id: 'f4',
          name: 'Industry Sector Volatility',
          category: 'INDUSTRY',
          score: 45,
          weightPercentage: 20,
          description: 'Logistics and supply chain sector seasonal risk factor.',
        },
      ],
    };
  }
}

export const riskService = new RiskService();
