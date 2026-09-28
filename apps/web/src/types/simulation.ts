export type FlowType = 'FUNDING' | 'REPAYMENT' | 'INVOICE_MINTING';

export interface StateChangeItem {
  label: string;
  before: string;
  after: string;
  delta: string;
}

export interface SimulationResult {
  success: boolean;
  flowType: FlowType;
  feeChargedUsd: number;
  cpuInstructions: number;
  memoryBytes: number;
  stateChanges: StateChangeItem[];
  errorReason?: string;
  simulationTimeMs: number;
}

export interface SimulationRequest {
  flowType: FlowType;
  contractAddress: string;
  methodName: string;
  args: Record<string, unknown>;
}
