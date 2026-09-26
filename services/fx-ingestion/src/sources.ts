/**
 * FX Ingestion Service — Data Sources
 *
 * Abstracts over multiple FX data providers.  Each provider implements
 * the FxSource interface.  Two concrete adapters are provided:
 *   - ExchangeRateApiSource  (exchangerate-api.com)
 *   - CurrencyApiSource      (currencyapi.com)
 *
 * The cross-checker in crosscheck.ts consumes the FxSource interface,
 * allowing test doubles to be injected without real HTTP calls.
 *
 * Issue #766
 */

import axios from "axios";
import { CurrencyCode, FxQuote } from "./types";
import pino from "pino";

const logger = pino({ name: "fx-ingestion:sources" });

/** All FX data sources must implement this interface. */
export interface FxSource {
  name: string;
  /**
   * Fetch the current rate for base/quote.
   * Returns null if the currency is temporarily unavailable.
   */
  fetchRate(base: CurrencyCode, quote: CurrencyCode): Promise<FxQuote | null>;
}

/** Price scaling: 1e7 to match Kora's oracle contract convention. */
export const PRICE_SCALE = 10_000_000n;

// ---------------------------------------------------------------------------
// ExchangeRate-API adapter
// ---------------------------------------------------------------------------

export class ExchangeRateApiSource implements FxSource {
  readonly name = "exchangerate-api";

  constructor(private readonly apiKey: string) {}

  async fetchRate(base: CurrencyCode, quote: CurrencyCode): Promise<FxQuote | null> {
    try {
      const url = `https://v6.exchangerate-api.com/v6/${this.apiKey}/pair/${base}/${quote}`;
      const res = await axios.get<{ conversion_rate: number; time_last_update_unix: number }>(url, {
        timeout: 5_000,
      });

      const rate = res.data.conversion_rate;
      if (!rate || !isFinite(rate) || rate <= 0) {
        logger.warn({ base, quote }, "ExchangeRateAPI returned invalid rate");
        return null;
      }

      return {
        base,
        quote,
        rateScaled: BigInt(Math.round(rate * 10_000_000)),
        fetchedAt: res.data.time_last_update_unix ?? Math.floor(Date.now() / 1000),
        source: this.name,
      };
    } catch (err) {
      logger.warn({ base, quote, err }, "ExchangeRateAPI fetch failed");
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// CurrencyAPI adapter
// ---------------------------------------------------------------------------

export class CurrencyApiSource implements FxSource {
  readonly name = "currencyapi";

  constructor(private readonly apiKey: string) {}

  async fetchRate(base: CurrencyCode, quote: CurrencyCode): Promise<FxQuote | null> {
    try {
      const url = `https://api.currencyapi.com/v3/latest?base_currency=${base}&currencies=${quote}`;
      const res = await axios.get<{
        data: Record<string, { code: string; value: number }>;
      }>(url, {
        headers: { apikey: this.apiKey },
        timeout: 5_000,
      });

      const entry = res.data?.data?.[quote];
      const rate = entry?.value;
      if (!rate || !isFinite(rate) || rate <= 0) {
        logger.warn({ base, quote }, "CurrencyAPI returned invalid rate");
        return null;
      }

      return {
        base,
        quote,
        rateScaled: BigInt(Math.round(rate * 10_000_000)),
        fetchedAt: Math.floor(Date.now() / 1000),
        source: this.name,
      };
    } catch (err) {
      logger.warn({ base, quote, err }, "CurrencyAPI fetch failed");
      return null;
    }
  }
}
