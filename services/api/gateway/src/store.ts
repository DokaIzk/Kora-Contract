/**
 * API Gateway — In-memory indexed store
 *
 * Production wiring replaces this with the indexer service's database; the
 * gateway itself stays stateless and only depends on the `IndexedStore`
 * interface. The in-memory implementation preserves insertion order so
 * cursor-based pagination is deterministic.
 *
 * Issue #753
 */

import { InvoiceRecord, ListingRecord, PositionRecord, RiskScoreRecord } from "./types";

export interface IndexedStore {
  invoices: InvoiceRecord[];
  listings: ListingRecord[];
  positions: PositionRecord[];
  riskScores: RiskScoreRecord[];
  lastIndexedLedger: number;
}

export function createMemoryStore(seed: Partial<IndexedStore> = {}): IndexedStore {
  return {
    invoices: seed.invoices ?? [],
    listings: seed.listings ?? [],
    positions: seed.positions ?? [],
    riskScores: seed.riskScores ?? [],
    lastIndexedLedger: seed.lastIndexedLedger ?? 0,
  };
}
