import { FxRateData, SupportedCurrency } from '../types/currency';

// Default static fallback rates (rates per 1 USD)
const DEFAULT_RATES: Record<SupportedCurrency, number> = {
  USD: 1.0,
  NGN: 1520.5,
  KES: 130.2,
  ZAR: 18.4,
  GHS: 14.8,
};

// Max freshness threshold: 1 hour in ms
const STALE_THRESHOLD_MS = 60 * 60 * 1000;

export class FxService {
  private ratesCache: Map<SupportedCurrency, FxRateData> = new Map();

  constructor() {
    this.initializeDefaultRates();
  }

  private initializeDefaultRates() {
    const now = Date.now();
    (Object.keys(DEFAULT_RATES) as SupportedCurrency[]).forEach((currency) => {
      this.ratesCache.set(currency, {
        currency,
        rateToUsd: DEFAULT_RATES[currency],
        timestamp: now,
        isStale: false,
      });
    });
  }

  public getRate(currency: SupportedCurrency): FxRateData {
    const data = this.ratesCache.get(currency);
    if (!data) {
      return {
        currency,
        rateToUsd: DEFAULT_RATES[currency] || 1.0,
        timestamp: Date.now(),
        isStale: true,
      };
    }

    const isStale = Date.now() - data.timestamp > STALE_THRESHOLD_MS;
    return { ...data, isStale };
  }

  public updateRate(currency: SupportedCurrency, rateToUsd: number, timestamp = Date.now()): FxRateData {
    const rateData: FxRateData = {
      currency,
      rateToUsd,
      timestamp,
      isStale: Date.now() - timestamp > STALE_THRESHOLD_MS,
    };
    this.ratesCache.set(currency, rateData);
    return rateData;
  }

  public convertFromUsd(amountUsd: number, targetCurrency: SupportedCurrency): {
    convertedAmount: number;
    rateData: FxRateData;
  } {
    const rateData = this.getRate(targetCurrency);
    const convertedAmount = amountUsd * rateData.rateToUsd;
    return { convertedAmount, rateData };
  }
}

export const fxService = new FxService();
