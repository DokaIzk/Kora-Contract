/**
 * On-chain relay — sets the KYB allowlist flag on the Stellar network.
 *
 * When a reviewer approves an SME, this relay submits an authorized
 * transaction that calls the `set_kyb_approved` entry point on the
 * `access_control` contract (or `invoice_nft` if the flag lives there).
 *
 * The relay is idempotent: if the SME is already flagged on-chain the
 * transaction is a no-op (the contract must enforce idempotency on its side).
 *
 * Issue: #762
 */

import { OnChainRelayResult } from "./types";

/**
 * Minimal interface for the Stellar relay signer.
 * Injected at construction time so the relay can be unit-tested with a
 * mock signer without touching the network.
 */
export interface RelaySigner {
  /**
   * Submit a `set_kyb_approved(smeAddress)` transaction.
   * @returns The transaction hash and ledger sequence.
   */
  setKybApproved(smeAddress: string): Promise<OnChainRelayResult>;
}

export class OnChainRelay {
  constructor(private readonly signer: RelaySigner) {}

  /**
   * Marks `smeAddress` as KYB-approved on-chain.
   *
   * Idempotent: calling this twice for the same address is safe.
   * The on-chain contract rejects double-approvals as a no-op so this
   * function does not need to guard against them itself.
   */
  async approveOnChain(smeAddress: string): Promise<OnChainRelayResult> {
    return this.signer.setKybApproved(smeAddress);
  }
}
