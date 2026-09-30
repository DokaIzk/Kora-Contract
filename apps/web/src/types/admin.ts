export type ProtocolParameterKey =
  | 'FEE_TIERS'
  | 'CONCENTRATION_CAPS'
  | 'GRACE_PERIODS'
  | 'VERIFIER_LIST'
  | 'CIRCUIT_BREAKER_THRESHOLDS';

export type ProposalStatus = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'REJECTED';

export interface ProtocolParameter {
  key: ProtocolParameterKey;
  label: string;
  currentValue: any;
  pendingValue?: any;
  unit?: string;
  description: string;
  lastModifiedBy: string;
  updatedAt: string;
}

export interface MultiSigProposal {
  id: string;
  parameterKey: ProtocolParameterKey;
  parameterLabel: string;
  proposedBy: string;
  currentValue: any;
  proposedValue: any;
  requiredSignatures: number;
  currentSignatures: string[]; // List of signer wallet addresses
  status: ProposalStatus;
  createdAt: string;
  expiresAt: string;
  effectDescription: string;
}

export interface AdminConsoleState {
  parameters: ProtocolParameter[];
  proposals: MultiSigProposal[];
  userWalletAddress: string;
  isAuthorizedSigner: boolean;
}
