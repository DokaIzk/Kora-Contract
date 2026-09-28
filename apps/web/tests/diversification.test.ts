import { DiversificationService } from '../src/services/diversificationService';

describe('Investor Diversification Insights Service (#791)', () => {
  let service: DiversificationService;

  beforeEach(() => {
    service = new DiversificationService();
  });

  it('should return empty diversification structure when portfolio is empty', () => {
    const result = service.calculateDiversification([]);
    expect(result.totalPortfolioUsd).toBe(0);
    expect(result.debtorExposures.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });

  it('should calculate diversification metrics and detect warning levels', () => {
    const positions = [
      { debtor: 'Acme Ltd', amountUsd: 2500, riskScore: 30, tenorDays: 30 },
      { debtor: 'Acme Ltd', amountUsd: 1000, riskScore: 30, tenorDays: 30 }, // 3500 total
      { debtor: 'Beta Corp', amountUsd: 6500, riskScore: 80, tenorDays: 60 }, // 6500 total out of 10000 (65%)
    ];

    const result = service.calculateDiversification(positions);
    expect(result.totalPortfolioUsd).toBe(10000);
    expect(result.debtorExposures.length).toBe(2);

    const betaItem = result.debtorExposures.find((d) => d.name === 'Beta Corp');
    expect(betaItem?.percentage).toBe(65);
    expect(betaItem?.status).toBe('BREACHED');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should check prospective contribution and detect cap breach before funding', () => {
    const currentPositions = [{ debtor: 'Debtor A', amountUsd: 2000, riskScore: 50, tenorDays: 30 }];
    const prospective = { debtor: 'Debtor A', amountUsd: 5000, riskScore: 50, tenorDays: 30 };

    const check = service.checkProspectiveContribution(currentPositions, prospective);
    expect(check.willBreach).toBe(true);
    expect(check.reason).toContain('breaches Debtor Concentration Cap');
  });
});
