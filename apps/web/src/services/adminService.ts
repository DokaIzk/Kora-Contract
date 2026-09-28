import { AdminConsoleState, MultiSigProposal, ProtocolParameter } from '../types/admin';

export class AdminService {
  private initialParameters: ProtocolParameter[] = [
    {
      key: 'FEE_TIERS',
      label: 'Protocol Platform Fee Tier',
      currentValue: '0.50%',
      description: 'Platform fee percentage charged on funded invoice volume.',
      lastModifiedBy: 'G_SIGNER_ALPHA_01',
      updatedAt: '2026-09-01T12:00:00Z',
    },
    {
      key: 'CONCENTRATION_CAPS',
      label: 'Maximum Debtor Exposure Cap',
      currentValue: '$25,000 USD (30% Max)',
      description: 'Maximum exposure allowed per single debtor across all investor portfolios.',
      lastModifiedBy: 'G_SIGNER_BETA_02',
      updatedAt: '2026-09-15T09:30:00Z',
    },
    {
      key: 'GRACE_PERIODS',
      label: 'Default Repayment Grace Period',
      currentValue: '7 Days',
      description: 'Buffer period before late penalty rates apply to invoice maturity.',
      lastModifiedBy: 'G_SIGNER_ALPHA_01',
      updatedAt: '2026-08-20T14:15:00Z',
    },
    {
      key: 'VERIFIER_LIST',
      label: 'Active Verifiers Count',
      currentValue: '5 Accredited Verifiers',
      description: 'List of authorized node operators verifiers performing risk scoring.',
      lastModifiedBy: 'G_SIGNER_GAMMA_03',
      updatedAt: '2026-09-10T16:45:00Z',
    },
    {
      key: 'CIRCUIT_BREAKER_THRESHOLDS',
      label: 'Protocol Paused Default Trigger',
      currentValue: '5.00% Default Rate',
      description: 'Automatic pause threshold for marketplace when pool default rate spikes.',
      lastModifiedBy: 'G_SIGNER_ALPHA_01',
      updatedAt: '2026-09-05T11:00:00Z',
    },
  ];

  private initialProposals: MultiSigProposal[] = [
    {
      id: 'PROP-101',
      parameterKey: 'FEE_TIERS',
      parameterLabel: 'Protocol Platform Fee Tier',
      proposedBy: 'G_SIGNER_ALPHA_01',
      currentValue: '0.50%',
      proposedValue: '0.40%',
      requiredSignatures: 3,
      currentSignatures: ['G_SIGNER_ALPHA_01', 'G_SIGNER_BETA_02'],
      status: 'PENDING',
      createdAt: '2026-09-27T10:00:00Z',
      expiresAt: '2026-10-04T10:00:00Z',
      effectDescription: 'Reduces platform fee from 0.50% to 0.40% to incentivize high-volume investor liquidity.',
    },
    {
      id: 'PROP-102',
      parameterKey: 'CONCENTRATION_CAPS',
      parameterLabel: 'Maximum Debtor Exposure Cap',
      proposedBy: 'G_SIGNER_BETA_02',
      currentValue: '$25,000 USD (30% Max)',
      proposedValue: '$35,000 USD (35% Max)',
      requiredSignatures: 3,
      currentSignatures: ['G_SIGNER_BETA_02'],
      status: 'PENDING',
      createdAt: '2026-09-28T08:00:00Z',
      expiresAt: '2026-10-05T08:00:00Z',
      effectDescription: 'Raises maximum single-debtor concentration limit from $25k to $35k for prime corporate invoices.',
    },
  ];

  public getAdminState(userWalletAddress = 'G_SIGNER_ALPHA_01'): AdminConsoleState {
    const authorizedSigners = ['G_SIGNER_ALPHA_01', 'G_SIGNER_BETA_02', 'G_SIGNER_GAMMA_03', 'G_SIGNER_DELTA_04'];
    const isAuthorized = authorizedSigners.includes(userWalletAddress);

    return {
      parameters: [...this.initialParameters],
      proposals: [...this.initialProposals],
      userWalletAddress,
      isAuthorizedSigner: isAuthorized,
    };
  }

  public createProposal(
    parameterKey: any,
    proposedValue: any,
    proposedBy: string,
    effectDescription: string
  ): MultiSigProposal {
    const param = this.initialParameters.find((p) => p.key === parameterKey);
    const newProp: MultiSigProposal = {
      id: `PROP-${Math.floor(100 + Math.random() * 900)}`,
      parameterKey,
      parameterLabel: param ? param.label : String(parameterKey),
      proposedBy,
      currentValue: param ? param.currentValue : 'N/A',
      proposedValue,
      requiredSignatures: 3,
      currentSignatures: [proposedBy],
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      effectDescription,
    };
    this.initialProposals.push(newProp);
    return newProp;
  }

  public signProposal(proposalId: string, signerAddress: string): MultiSigProposal {
    const prop = this.initialProposals.find((p) => p.id === proposalId);
    if (!prop) throw new Error(`Proposal ${proposalId} not found`);

    if (!prop.currentSignatures.includes(signerAddress)) {
      prop.currentSignatures.push(signerAddress);
    }

    if (prop.currentSignatures.length >= prop.requiredSignatures) {
      prop.status = 'APPROVED';
    }

    return prop;
  }

  public executeProposal(proposalId: string): MultiSigProposal {
    const prop = this.initialProposals.find((p) => p.id === proposalId);
    if (!prop) throw new Error(`Proposal ${proposalId} not found`);
    if (prop.status !== 'APPROVED') throw new Error(`Proposal ${proposalId} must reach quorum before execution`);

    prop.status = 'EXECUTED';
    const param = this.initialParameters.find((p) => p.key === prop.parameterKey);
    if (param) {
      param.currentValue = prop.proposedValue;
      param.lastModifiedBy = prop.proposedBy;
      param.updatedAt = new Date().toISOString();
    }

    return prop;
  }
}

export const adminService = new AdminService();
