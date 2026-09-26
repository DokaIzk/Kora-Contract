/**
 * FX Ingestion Service — Oracle Relay
 *
 * Publishes a consensus FX rate to the Kora price_oracle contract
 * via an authorized relay account.  Respects the oracle's staleness-guard
 * by including the fetch timestamp and refusing to publish rates older than
 * `maxStalenessSeconds`.
 *
 * Rate-limiting: at most 1 publication per pair per `pollIntervalMs` cycle,
 * enforced at the relay level to protect the relay account from abuse.
 *
 * Issue #766
 */

import { FxIngestionConfig, CurrencyCode } from "./types";
import pino from "pino";

const logger = pino({ name: "fx-ingestion:relay" });

export interface PublishResult {
  base: CurrencyCode;
  quote: CurrencyCode;
  txHash?: string;
  skipped: boolean;
  reason?: string;
}

export class OracleRelay {
  /** Tracks last publish time per pair to enforce per-cycle rate limit. */
  private lastPublishAt: Map<string, number> = new Map();

  constructor(private readonly config: FxIngestionConfig) {}

  /**
   * Publish a consensus rate to the on-chain price_oracle.
   * Returns a PublishResult indicating whether the publication was submitted
   * or skipped (and why).
   */
  async publish(
    base: CurrencyCode,
    quote: CurrencyCode,
    rateScaled: bigint,
    fetchedAt: number
  ): Promise<PublishResult> {
    const pairKey = `${base}/${quote}`;
    const nowSec = Math.floor(Date.now() / 1000);

    // Staleness guard: refuse to publish data that is too old
    const age = nowSec - fetchedAt;
    if (age > this.config.maxStalenessSeconds) {
      logger.warn(
        { pairKey, age, maxStaleness: this.config.maxStalenessSeconds },
        "Rate too stale — skipping publication"
      );
      return { base, quote, skipped: true, reason: "stale_rate" };
    }

    // Per-cycle rate limit: prevent double-publishing within one poll cycle
    const last = this.lastPublishAt.get(pairKey);
    if (last !== undefined && nowSec - last < this.config.pollIntervalMs / 1000) {
      logger.debug({ pairKey }, "Rate limit: skipping duplicate publish in same cycle");
      return { base, quote, skipped: true, reason: "rate_limited" };
    }

    try {
      const txHash = await this._submitToOracle(base, quote, rateScaled, fetchedAt);
      this.lastPublishAt.set(pairKey, nowSec);
      logger.info({ pairKey, rateScaled: rateScaled.toString(), txHash }, "Rate published");
      return { base, quote, txHash, skipped: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ pairKey, message }, "Oracle publish failed");
      return { base, quote, skipped: true, reason: `publish_error: ${message}` };
    }
  }

  /**
   * Override in subclasses or tests to inject a mock Stellar transaction.
   *
   * In production this would:
   *   const server = new SorobanRpc.Server(this.config.rpcUrl);
   *   const keypair = Keypair.fromSecret(this.config.relaySecret);
   *   const contract = new Contract(this.config.oracleContractAddress);
   *   // call set_price(base, quote, rateScaled, fetchedAt)
   *   ...
   */
  protected async _submitToOracle(
    _base: CurrencyCode,
    _quote: CurrencyCode,
    _rateScaled: bigint,
    _fetchedAt: number
  ): Promise<string> {
    throw new Error("Stellar RPC not configured — inject a subclass in production");
  }
}
