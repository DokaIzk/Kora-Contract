/**
 * Reporting Service — Types
 *
 * Domain types for data export and regulatory reporting.
 * Issue #770: Build Data Export Service for Regulatory Reporting.
 */

/** Supported export formats. */
export type ExportFormat = "csv" | "pdf";

/** Scope of the export. */
export type ExportScope = "per_user" | "protocol_wide";

/** Status of an asynchronous export job. */
export type ExportStatus = "pending" | "processing" | "ready" | "failed";

/** A funding event: investor funded an invoice. */
export interface FundingEvent {
  invoiceId: string;
  asset: string;           // e.g. "USDC", "EURC"
  amount: bigint;          // in stroops (7 decimal places)
  timestamp: number;       // Unix seconds
  txHash: string;
}

/** A repayment event: SME repaid an invoice. */
export interface RepaymentEvent {
  invoiceId: string;
  asset: string;
  amount: bigint;
  timestamp: number;
  txHash: string;
}

/** A yield distribution event: investor received yield. */
export interface YieldEvent {
  invoiceId: string;
  asset: string;
  principalReturned: bigint;
  yieldAmount: bigint;
  timestamp: number;
  txHash: string;
}

/** A fee event: protocol fee collected. */
export interface FeeEvent {
  invoiceId: string;
  asset: string;
  feeAmount: bigint;
  feeBps: number;
  timestamp: number;
  txHash: string;
}

/** Per-asset totals — avoids conflating different settlement assets. */
export interface AssetSummary {
  asset: string;
  totalFunded: bigint;
  totalRepaid: bigint;
  totalYield: bigint;
  totalFees: bigint;
}

/** All event data for one user over a date range. */
export interface UserStatement {
  userAddress: string;
  fromTs: number;
  toTs: number;
  funding: FundingEvent[];
  repayments: RepaymentEvent[];
  yields: YieldEvent[];
  fees: FeeEvent[];
  /** Totals broken down by asset — never conflates USDC with EURC etc. */
  summaryByAsset: AssetSummary[];
}

/** Protocol-wide aggregate export. */
export interface ProtocolStatement {
  fromTs: number;
  toTs: number;
  totalInvoicesFinanced: number;
  totalInvoicesRepaid: number;
  totalInvoicesDefaulted: number;
  summaryByAsset: AssetSummary[];
}

/** An asynchronous export job record. */
export interface ExportJob {
  jobId: string;
  scope: ExportScope;
  format: ExportFormat;
  userAddress?: string;    // set for per_user scope
  fromTs: number;
  toTs: number;
  status: ExportStatus;
  outputPath?: string;     // local file path when ready
  errorMessage?: string;
  requestedAt: number;
  completedAt?: number;
}
