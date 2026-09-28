export type SupportedCurrency = 'USD' | 'NGN' | 'KES' | 'ZAR' | 'GHS';

export interface FxRateData {
  currency: SupportedCurrency;
  rateToUsd: number; // e.g. NGN 1500 per USD
  timestamp: number;
  isStale: boolean;
}

export interface CurrencyFormatOptions {
  showCanonicalFirst?: boolean;
  showStaleBadge?: boolean;
  precision?: number;
}
