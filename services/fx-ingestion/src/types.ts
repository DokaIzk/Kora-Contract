/**
 * FX Ingestion Service — Types
 *
 * Domain types for the FX rate ingestion and price oracle relay.
 * Issue #766: Currency Conversion and FX Rate Ingestion Service.
 */

/** ISO 4217 currency codes supported by the protocol. */
export type CurrencyCode =
  | "USDC"    // Settlement stablecoin
  | "EURC"    // Euro stablecoin
  | "NGN"     // Nigerian Naira
  | "KES"     // Kenyan Shilling
  | "GHS"     // Ghanaian Cedi
  | "ZAR"     // South African Rand
  | "TZS"     // Tanzanian Shilling
  | "UGX"     // Ugandan Shilling
  | "XOF"     // West African CFA franc
  | "EGP";    // Egyptian Pound

/** A single FX rate quote from one data source. */
export interface FxQuote {
  base: CurrencyCode;
  quote: CurrencyCode;
  /** Rate scaled by 1e7 to match the price_oracle contract convention. */
  rateScaled: bigint;
  /** Unix timestamp (seconds) when this quote was fetched. */
  fetchedAt: number;
  source: string;
}

/** Result from cross-checking two or more sources. */
export interface CrossCheckResult {
  base: CurrencyCode;
  quote: CurrencyCode;
  /**
   * Arithmetic mean of all valid source rates — only set when cross-check passes.
   */
  consensusRate?: bigint;
  /** Whether sources agreed within the configured divergence threshold. */
  passed: boolean;
  /** Divergence in basis points between min and max source rates. */
  divergenceBps: number;
  quotes: FxQuote[];
  reason?: string;
}

/** Configuration for the FX ingestion service. */
export interface FxIngestionConfig {
  /** Currencies to track. Each will be priced against USDC. */
  currencies: CurrencyCode[];
  /** Quote currency (the stable side; typically USDC). */
  quoteCurrency: CurrencyCode;
  /** Max divergence between sources before rejecting publication (bps). Default: 200. */
  maxDivergenceBps: number;
  /** How often to run the ingestion cycle (ms). Default: 300_000 (5 min). */
  pollIntervalMs: number;
  /** Stellar price_oracle contract address. */
  oracleContractAddress: string;
  /** Secret key of the FX relay account. */
  relaySecret: string;
  /** Stellar RPC endpoint. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Maximum staleness (seconds) the oracle will accept. Default: 3600. */
  maxStalenessSeconds: number;
}
