/**
 * API Gateway — Types
 *
 * Public read-only gateway over the indexer database: invoices, listings,
 * positions, and risk scores. All writes remain on-chain (signed by the user's
 * wallet) — this layer serves indexed reads with filtering, sorting, and
 * cursor-based pagination.
 *
 * Indexer lag is transparent: every response carries `lastIndexedLedger` so
 * clients know data freshness.
 *
 * Issue #753
 */

export interface InvoiceRecord {
  id: string;
  sme: string;
  debtorHash: string;
  amount: string;
  currency: string;
  dueDate: number;
  ipfsCid: string;
  riskScore: number;
  riskTier: string;
  status: string;
  createdAt: number;
}

export interface ListingRecord {
  invoiceId: string;
  seller: string;
  askingPrice: string;
  faceValue: string;
  token: string;
  fundedAmount: string;
  fundingDeadline: number;
  isActive: boolean;
}

export interface PositionRecord {
  investor: string;
  invoiceId: string;
  contributed: string;
  shareBps: number;
  yieldClaimed: string;
}

export interface RiskScoreRecord {
  subject: string; // SME address or debtor hash
  kind: "sme" | "debtor";
  score: number;
  verifier: string;
  updatedAt: number;
}

/** Generic filter operators for indexed fields. */
export interface FieldFilter<T> {
  eq?: T;
  in?: T[];
  gte?: T;
  lte?: T;
}

export interface InvoiceFilter {
  sme?: FieldFilter<string>;
  status?: FieldFilter<string>;
  riskTier?: FieldFilter<string>;
  riskScore?: FieldFilter<number>;
  currency?: FieldFilter<string>;
}

export interface ListingFilter {
  seller?: FieldFilter<string>;
  isActive?: boolean;
  token?: FieldFilter<string>;
}

export interface PositionFilter {
  investor?: FieldFilter<string>;
  invoiceId?: FieldFilter<string>;
}

export interface RiskScoreFilter {
  kind?: "sme" | "debtor";
  verifier?: FieldFilter<string>;
  score?: FieldFilter<number>;
}

export type SortDir = "asc" | "desc";

export interface PageArgs {
  /** Opaque cursor from a previous response (base64 offset). */
  cursor?: string;
  /** Page size, clamped to 1–100. */
  limit?: number;
}

export interface Page<T> {
  data: T[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
  /** Ledger sequence the indexer had processed when serving this page. */
  lastIndexedLedger: number;
}

/** API-key access tiers for third-party integrators. */
export type AccessTier = "free" | "standard" | "enterprise";

export interface ApiKeyRecord {
  key: string;
  tier: AccessTier;
}
