/**
 * Type definitions for Transaction Status Tracker Component (#776)
 */

export type TxStepState = 'idle' | 'simulating' | 'submitting' | 'pending' | 'confirmed' | 'failed' | 'timeout';

export type TxFailureClass =
  | 'simulation_failed'
  | 'submission_failed'
  | 'on_chain_execution_failed'
  | 'timeout_unconfirmed';

export interface TxStatusState {
  state: TxStepState;
  txHash: string | null;
  ledgerSequence: number | null;
  failureClass: TxFailureClass | null;
  userFacingMessage: string;
  rawErrorDetails: string | null;
  submittedAt: number | null;
  confirmedAt: number | null;
  isLateSuccess: boolean;
}

export interface TxTrackerProps {
  status: TxStatusState;
  onRetry?: () => void;
  onClose?: () => void;
}
