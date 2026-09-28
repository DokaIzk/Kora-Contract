import { FlowType, SimulationRequest, SimulationResult, StateChangeItem } from '../types/simulation';

export class SimulationService {
  public async simulateTransaction(request: SimulationRequest): Promise<SimulationResult> {
    const startTime = Date.now();

    // Simulate network delay for pre-flight check
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Handle invalid arguments or failure simulation
    if (request.args.shouldFail === true || request.args.amount === 0) {
      return {
        success: false,
        flowType: request.flowType,
        feeChargedUsd: 0,
        cpuInstructions: 0,
        memoryBytes: 0,
        stateChanges: [],
        errorReason: (request.args.failReason as string) || 'Simulation failed: Invalid contract parameters or insufficient balance.',
        simulationTimeMs: Date.now() - startTime,
      };
    }

    const stateChanges: StateChangeItem[] = this.decodeFlowStateChanges(request);

    return {
      success: true,
      flowType: request.flowType,
      feeChargedUsd: 0.0001,
      cpuInstructions: 1250000,
      memoryBytes: 45000,
      stateChanges,
      simulationTimeMs: Date.now() - startTime,
    };
  }

  private decodeFlowStateChanges(request: SimulationRequest): StateChangeItem[] {
    const amount = (request.args.amount as number) || 1000;
    const currency = (request.args.currency as string) || 'USDC';

    switch (request.flowType) {
      case 'FUNDING':
        return [
          {
            label: `Investor Wallet (${currency})`,
            before: `$${(amount * 2).toLocaleString()}`,
            after: `$${amount.toLocaleString()}`,
            delta: `-$${amount.toLocaleString()}`,
          },
          {
            label: 'Marketplace Escrow',
            before: '$0',
            after: `$${amount.toLocaleString()}`,
            delta: `+$${amount.toLocaleString()}`,
          },
          {
            label: 'Estimated Protocol Fee',
            before: '$0.00',
            after: '$0.0001',
            delta: '+$0.0001',
          },
        ];

      case 'REPAYMENT':
        return [
          {
            label: `SME Wallet (${currency})`,
            before: `$${(amount * 1.5).toLocaleString()}`,
            after: `$${(amount * 0.5).toLocaleString()}`,
            delta: `-$${amount.toLocaleString()}`,
          },
          {
            label: 'Financing Pool Yield Pool',
            before: '$0',
            after: `$${amount.toLocaleString()}`,
            delta: `+$${amount.toLocaleString()}`,
          },
          {
            label: 'Invoice NFT Status',
            before: 'Listed',
            after: 'Repaid',
            delta: 'Status -> Repaid',
          },
        ];

      case 'INVOICE_MINTING':
        return [
          {
            label: 'Invoice NFT ID',
            before: 'Unminted',
            after: `#${(request.args.invoiceId as number) || 101}`,
            delta: 'Minted',
          },
          {
            label: 'Risk Registry SME Credit Limit',
            before: '$50,000',
            after: `$${(50000 - amount).toLocaleString()}`,
            delta: `-$${amount.toLocaleString()}`,
          },
        ];

      default:
        return [
          {
            label: 'Contract State',
            before: 'Unchanged',
            after: 'Updated',
            delta: 'Simulated OK',
          },
        ];
    }
  }
}

export const simulationService = new SimulationService();
