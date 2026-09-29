/**
 * Service for Real-Time Transaction Status Tracker (#776)
 * Manages explicit terminal & non-terminal transaction states, failure classification,
 * and late-success reconciliation after timeout.
 */

import { TxStatusState, TxFailureClass } from '../types/txTracker';

export class TxTrackerService {
  public static createInitialState(): TxStatusState {
    return {
      state: 'idle',
      txHash: null,
      ledgerSequence: null,
      failureClass: null,
      userFacingMessage: 'Ready to submit transaction.',
      rawErrorDetails: null,
      submittedAt: null,
      confirmedAt: null,
      isLateSuccess: false,
    };
  }

  public static transitionToSimulating(current: TxStatusState): TxStatusState {
    return {
      ...current,
      state: 'simulating',
      userFacingMessage: 'Simulating transaction parameters on Soroban...',
      failureClass: null,
      rawErrorDetails: null,
    };
  }

  public static transitionToSubmitting(current: TxStatusState): TxStatusState {
    return {
      ...current,
      state: 'submitting',
      userFacingMessage: 'Requesting wallet signature...',
    };
  }

  public static transitionToPending(current: TxStatusState, txHash: string): TxStatusState {
    return {
      ...current,
      state: 'pending',
      txHash,
      submittedAt: Date.now(),
      userFacingMessage: 'Transaction submitted. Awaiting ledger confirmation...',
    };
  }

  public static transitionToConfirmed(current: TxStatusState, ledgerSequence: number): TxStatusState {
    const isLate = current.state === 'timeout';
    return {
      ...current,
      state: 'confirmed',
      ledgerSequence,
      confirmedAt: Date.now(),
      isLateSuccess: isLate,
      userFacingMessage: isLate
        ? `Reconciled! Transaction confirmed on ledger #${ledgerSequence} (after initial timeout).`
        : `Transaction confirmed on ledger #${ledgerSequence}!`,
    };
  }

  public static transitionToFailure(
    current: TxStatusState,
    failureClass: TxFailureClass,
    rawError: string,
  ): TxStatusState {
    let userMsg = 'Transaction failed.';

    switch (failureClass) {
      case 'simulation_failed':
        userMsg = 'Simulation error: Pre-flight check failed. Contract bounds or inputs may be invalid.';
        break;
      case 'submission_failed':
        userMsg = 'Signature or Submission error: Transaction was rejected or failed RPC broadcast.';
        break;
      case 'on_chain_execution_failed':
        userMsg = 'Execution error: On-chain transaction reverted during execution.';
        break;
      case 'timeout_unconfirmed':
        userMsg = 'Confirmation timeout: Transaction has not yet confirmed. Polling continues in background.';
        break;
    }

    return {
      ...current,
      state: failureClass === 'timeout_unconfirmed' ? 'timeout' : 'failed',
      failureClass,
      userFacingMessage: userMsg,
      rawErrorDetails: rawError,
    };
  }
}
