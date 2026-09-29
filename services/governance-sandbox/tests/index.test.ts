import { simulateImpact, ProtocolSnapshot } from '../src';

const snapshot: ProtocolSnapshot = {
  capturedAt: 'ledger-100',
  concentrationCap: 100n,
  listings: [
    { id: 'over', concentration: 120n, feeTier: 'standard', fundedAmount: 10_000n },
    { id: 'under', concentration: 90n, feeTier: 'standard', fundedAmount: 20_000n },
    { id: 'other', concentration: 50n, feeTier: 'premium', fundedAmount: 5_000n },
  ],
  investors: [{ address: 'near', exposure: 96n }, { address: 'far', exposure: 40n }],
};

test('calculates cap impact against current listings and exposures', () => {
  const result = simulateImpact({ type: 'concentration_cap', from: 150n, to: 100n }, snapshot);
  expect(result.supported).toBe(true);
  expect(result.affectedListings).toEqual(['over']);
  expect(result.investorsNearNewCap).toBe(1);
  expect(result.currentStateAt).toBe('ledger-100');
});

test('calculates fee-tier impact using affected funded volume', () => {
  const result = simulateImpact({ type: 'fee_tier', tier: 'standard', fromBps: 50, toBps: 100 }, snapshot);
  expect(result.affectedFeeTierListings).toBe(2);
  expect(result.estimatedFeeDelta).toBe(150n);
});

test('falls back to a generic diff for unsupported types', () => {
  const result = simulateImpact({ type: 'unknown', from: 2, to: 3 }, snapshot);
  expect(result.supported).toBe(false);
  expect(result.proposalDiff).toEqual({ type: 'unknown', from: 2, to: 3 });
});