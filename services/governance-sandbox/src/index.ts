export type Listing = { id: string; concentration: bigint; feeTier: string; fundedAmount: bigint };
export type Investor = { address: string; exposure: bigint };
export type ProtocolSnapshot = {
  capturedAt: string;
  concentrationCap: bigint;
  listings: Listing[];
  investors: Investor[];
};

export type ParameterChange =
  | { type: 'concentration_cap'; from: bigint; to: bigint; proximityBps?: number }
  | { type: 'fee_tier'; tier: string; fromBps: number; toBps: number }
  | { type: string; from: unknown; to: unknown };

export type Impact = {
  supported: boolean;
  proposalDiff: { type: string; from: unknown; to: unknown };
  currentStateAt: string;
  disclaimer: 'Current-state simulation; state may change before execution.';
  affectedListings?: string[];
  investorsNearNewCap?: number;
  affectedFeeTierListings?: number;
  estimatedFeeDelta?: bigint;
};

type Plugin = (change: ParameterChange, snapshot: ProtocolSnapshot) => Impact;

const unsupported: Plugin = (change, snapshot) => ({
  supported: false,
  proposalDiff: { type: change.type, from: change.from, to: change.to },
  currentStateAt: snapshot.capturedAt,
  disclaimer: 'Current-state simulation; state may change before execution.',
});

const plugins: Record<string, Plugin> = {
  concentration_cap: (change, snapshot) => {
    if (change.type !== 'concentration_cap') return unsupported(change, snapshot);
    const proximityBps = change.proximityBps ?? 500;
    const floor = (change.to * BigInt(10_000 - proximityBps)) / 10_000n;
    return {
      supported: true,
      proposalDiff: { type: change.type, from: change.from, to: change.to },
      currentStateAt: snapshot.capturedAt,
      disclaimer: 'Current-state simulation; state may change before execution.',
      affectedListings: snapshot.listings.filter((item) => item.concentration > change.to).map((item) => item.id),
      investorsNearNewCap: snapshot.investors.filter((item) => item.exposure >= floor && item.exposure <= change.to).length,
    };
  },
  fee_tier: (change, snapshot) => {
    if (change.type !== 'fee_tier') return unsupported(change, snapshot);
    const listings = snapshot.listings.filter((item) => item.feeTier === change.tier);
    const delta = listings.reduce(
      (total, item) => total + (item.fundedAmount * BigInt(change.toBps - change.fromBps)) / 10_000n,
      0n,
    );
    return {
      supported: true,
      proposalDiff: { type: change.type, from: change.fromBps, to: change.toBps },
      currentStateAt: snapshot.capturedAt,
      disclaimer: 'Current-state simulation; state may change before execution.',
      affectedFeeTierListings: listings.length,
      estimatedFeeDelta: delta,
    };
  },
};

export function simulateImpact(change: ParameterChange, snapshot: ProtocolSnapshot): Impact {
  return (plugins[change.type] ?? unsupported)(change, snapshot);
}