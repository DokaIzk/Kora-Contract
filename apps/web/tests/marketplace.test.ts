import {
  parseMarketplaceSearchParams,
  serializeMarketplaceState,
  applyMarketplaceFilters,
} from '../src/components/marketplace/marketplaceFilters';
import { MarketplaceListing } from '../src/types/marketplace';

function makeListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: 'l-1',
    invoiceNumber: 'INV-1001',
    debtorName: 'Acme Corp',
    debtorCountry: 'DE',
    currency: 'EUR',
    faceValue: 100000,
    discountRateB0ps: 500,
    expectedYieldB0ps: 600,
    tenorDays: 60,
    riskTier: 'B',
    riskScore: 50,
    fundingStatus: 'open',
    fundedAmount: 0,
    targetAmount: 100000,
    fundingProgress: 0,
    maturityDate: '2024-12-31',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

describe('marketplace filter parsing', () => {
  it('parses combined filters from query params', () => {
    const search =
      '?riskTier=A,C&tenorMinDays=30&tenorMaxDays=90&amp;yieldMinB0ps=500&yieldMaxB0ps=900&fundingStatus=open,fully_funded&sortField=expectedYield&sortDirection=asc&page=2&pageSize=10';
    const state = parseMarketplaceSearchParams(search);
    expect(state.filters.riskTiers).toEqual(['A', 'C']);
    expect(state.filters.tenorMinDays).toBe(30);
    expect(state.filters.tenorMaxDays).toBe(90);
    expect(state.filters.yieldMinB0ps).toBe(500);
    expect(state.filters.yieldMaxB0ps).toBe(900);
    expect(state.filters.fundingStatuses).toEqual(['open', 'fully_funded']);
    expect(state.sort).toEqual({ field: 'expectedYield', direction: 'asc' });
    expect(state.page).toBe(2);
    expect(state.pageSize).toBe(10);
  });

  it('discards invalid values and falls back to defaults', () => {
    const state = parseMarketplaceSearchParams('?riskTier=Z&sortField=bogus&sortDirection=up&page=abc');
    expect(state.filters.riskTiers).toBeUndefined();
    expect(state.sort.field).toBe('createdAt');
    expect(state.sort.direction).toBe('desc');
    expect(state.page).toBe(1);
  });
});

describe('marketplace URL round-trip', () => {
  it('round-trips state through serialization', () => {
    const original = parseMarketplaceSearchParams(
      '?riskTier=A,C&tenorMinDays=30&tenorMaxDays=90&amp;yieldMinB0ps=500&yieldMaxB0ps=900&fundingStatus=open&sortField=expectedYield&sortDirection=asc&page=2&pageSize=10',
    );
    const serialized = serializeMarketplaceState(original);
    const roundTripped = parseMarketplaceSearchParams(`?${serialized}`);
    expect(roundTripped).toEqual(original);
  });

  it('omits default page/pageSize from serialized state', () => {
    const state = parseMarketplaceSearchParams('');
    const serialized = serializeMarketplaceState(state);
    expect(serialized).not.toContain('page=');
    expect(serialized).not.toContain('pageSize=');
  });
});

describe('applyMarketplaceFilters', () => {
  const listings = [
    makeListing({ id: 'l-1', riskTier: 'A', tenorDays: 30, expectedYieldB0ps: 500, fundingStatus: 'open', createdAt: '2024-01-01' }),
    makeListing({ id: 'l-2', riskTier: 'B', tenorDays: 60, expectedYieldB0ps: 700, fundingStatus: 'partially_funded', createdAt: '2024-02-01' }),
    makeListing( { id: 'l-3', riskTier: 'C', tenorDays: 90, expectedYieldB0ps: 900, fundingStatus: 'fully_funded', createdAt: '2024-03-01' }),
  ];

  it('combines risk, tenor, yield and funding filters', () => {
    const result = applyMarketplaceFilters(
      listings,
      { riskTiers: ['B'], tenorMinDays: 50, yieldMinB0ps: 600, fundingStatuses: ['partially_funded'] },
      { field: 'expectedYield', direction: 'desc' },
    );
    expect(result.map((l) => l.id)).toEqual(['l-2']);
  });

  it('sorts by expected yield ascending', () => {
    const result = applyMarketplaceFilters(listings, {}, { field: 'expectedYield', direction: 'asc' });
    expect(result.map((l) => l.id)).toEqual(['l-1', 'l-2', 'l-3']);
  });

  it('sorts by tenor descending', () => {
    const result = applyMarketplaceFilters(listings, {}, { field: 'tenorDays', direction: 'desc' });
    expect(result.map((l) => l.id)).toEqual(['l-3', 'l-2', 'l-1']);
  });

  it('returns empty array when no listings match', () => {
    const result = applyMarketplaceFilters(listings, { yieldMinB0ps: 10000 }, { field: 'createdAt', direction: 'desc' });
    expect(result).toEqual([]);
  });

  it('filters by search term across invoice and debtor', () => {
    const result = applyMarketplaceFilters(
      [makeListing({ id: 'l-1', debtorName: 'Acme Corp' }), makeListing({ id: 'l-2', debtorName: 'Globex Ltd' })],
      { search: 'globex' },
      { field: 'createdAt', direction: 'desc' },
    );
    expect(result.map((l) => l.id)).toEqual(['l-2']);
  });
});
