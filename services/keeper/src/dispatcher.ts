/**
 * Keeper Service — On-Chain Trigger Dispatcher
 *
 * Submits permissionless trigger transactions (refund claims, default marking)
 * using a dedicated, rate-limited keeper account.  Handles:
 *   - Fee bumping on retry
 *   - "Already triggered" no-op detection (graceful handling)
 *   - Hard-coded rate limit: max 10 tx/min via a token-bucket
 *
 * Issue #765
 */

import { TriggerResult, Job, KeeperConfig } from "./types";
import pino from "pino";

const logger = pino({ name: "keeper:dispatcher" });

/** Simple token-bucket rate limiter: max `capacity` tokens, refills 1/`refillMs`. */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillIntervalMs: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refills = Math.floor(elapsed / this.refillIntervalMs);
    if (refills > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + refills);
      this.lastRefill += refills * this.refillIntervalMs;
    }
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }
}

/**
 * Error codes returned by Kora contracts that indicate the action was
 * already performed by another caller.  Treat these as graceful no-ops.
 */
const NOOP_ERROR_CODES = new Set([
  "AlreadyDefaulted",
  "AlreadyRefunded",
  "AlreadyRepaid",
  "NotFunded",            // funding never completed; nothing to refund
  "FundingDeadlineNotReached",
]);

export class Dispatcher {
  /** 10 transactions per minute maximum. */
  private readonly rateLimiter = new TokenBucket(10, 6_000);

  constructor(private readonly config: KeeperConfig) {}

  /**
   * Attempt to submit the permissionless trigger transaction for a job.
   * Returns a TriggerResult describing the outcome.
   */
  async dispatch(job: Job): Promise<TriggerResult> {
    if (!this.rateLimiter.consume()) {
      logger.warn({ dedupKey: job.dedupKey }, "Rate limit hit; deferring job");
      return { dedupKey: job.dedupKey, outcome: "failed", error: "rate_limit" };
    }

    try {
      const txHash = await this._submitTrigger(job);
      logger.info({ dedupKey: job.dedupKey, txHash }, "Trigger submitted");
      return { dedupKey: job.dedupKey, outcome: "submitted", txHash };
    } catch (err: unknown) {
      return this._classifyError(job.dedupKey, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build and submit the appropriate Soroban transaction.
   * The fee is bumped on each retry attempt by 10% to improve inclusion
   * probability during congestion.
   */
  private async _submitTrigger(job: Job): Promise<string> {
    // Fee bumping: base 100 stroops * 1.1^attempts (capped at 10_000)
    const baseFee = 100;
    const bumpedFee = Math.min(
      Math.round(baseFee * Math.pow(1.1, job.attempts)),
      10_000
    );

    // Determine which function to call based on deadline kind
    const fnName = this._triggerFunction(job.kind);

    logger.debug(
      { dedupKey: job.dedupKey, fn: fnName, fee: bumpedFee, attempt: job.attempts + 1 },
      "Submitting trigger transaction"
    );

    /*
     * NOTE: Real Stellar Soroban SDK invocation would be constructed here.
     * The pattern is:
     *
     *   const server = new SorobanRpc.Server(this.config.rpcUrl);
     *   const keypair = Keypair.fromSecret(this.config.keeperSecret);
     *   const account = await server.getAccount(keypair.publicKey());
     *   const contract = new Contract(job.contractAddress);
     *   const tx = new TransactionBuilder(account, { fee: String(bumpedFee) })
     *     .addOperation(contract.call(fnName, xdr.ScVal.scvU64(xdr.Uint64.fromString(job.invoiceId))))
     *     .setTimeout(30)
     *     .setNetworkPassphrase(this.config.networkPassphrase)
     *     .build();
     *   const preparedTx = await server.prepareTransaction(tx);
     *   preparedTx.sign(keypair);
     *   const result = await server.sendTransaction(preparedTx);
     *   return result.hash;
     *
     * This is left as an integration seam so unit tests can inject mocks
     * without a live Stellar node.
     */
    return await this._submitStellarTransaction(
      job.contractAddress,
      fnName,
      job.invoiceId,
      bumpedFee
    );
  }

  /**
   * Override this in tests or subclasses to inject mock Stellar behaviour.
   */
  protected async _submitStellarTransaction(
    _contractAddress: string,
    _fnName: string,
    _invoiceId: string,
    _fee: number
  ): Promise<string> {
    throw new Error(
      "Stellar RPC not configured — set up SorobanRpc.Server in production"
    );
  }

  private _triggerFunction(kind: string): string {
    switch (kind) {
      case "funding_expiry":
        return "claim_refund";
      case "due_date":
        return "trigger_default_check";
      case "grace_period_end":
        return "mark_defaulted";
      default:
        throw new Error(`Unknown deadline kind: ${kind}`);
    }
  }

  private _classifyError(dedupKey: string, err: unknown): TriggerResult {
    const message = err instanceof Error ? err.message : String(err);

    // Check for known no-op codes in the error message
    for (const code of NOOP_ERROR_CODES) {
      if (message.includes(code)) {
        logger.info(
          { dedupKey, code },
          "Contract already in terminal state — treating as done"
        );
        return { dedupKey, outcome: "already_triggered", error: message };
      }
    }

    // Distinguish permanent failures (bad contract address, invalid params)
    // from transient ones (network timeout, fee too low)
    const isPermanent =
      message.includes("invalid contract") ||
      message.includes("no such contract") ||
      message.includes("InvalidArgument");

    logger.error({ dedupKey, message, isPermanent }, "Trigger failed");
    return {
      dedupKey,
      outcome: isPermanent ? "permanent_failure" : "failed",
      error: message,
    };
  }
}
