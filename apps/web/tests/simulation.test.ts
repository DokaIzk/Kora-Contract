import { SimulationService } from '../src/services/simulationService';

describe('Transaction Simulation Service (#785)', () => {
  let simulation: SimulationService;

  beforeEach(() => {
    simulation = new SimulationService();
  });

  it('should simulate successful funding flow and return decoded state changes', async () => {
    const result = await simulation.simulateTransaction({
      flowType: 'FUNDING',
      contractAddress: 'C_MARKETPLACE_001',
      methodName: 'fund_invoice',
      args: { amount: 2000, currency: 'USDC' },
    });

    expect(result.success).toBe(true);
    expect(result.flowType).toBe('FUNDING');
    expect(result.stateChanges.length).toBe(3);
    expect(result.feeChargedUsd).toBe(0.0001);
    expect(result.cpuInstructions).toBeGreaterThan(0);
  });

  it('should simulate successful repayment flow', async () => {
    const result = await simulation.simulateTransaction({
      flowType: 'REPAYMENT',
      contractAddress: 'C_FINANCING_POOL_001',
      methodName: 'repay_invoice',
      args: { invoiceId: 101, amount: 10000, currency: 'USDC' },
    });

    expect(result.success).toBe(true);
    expect(result.flowType).toBe('REPAYMENT');
    expect(result.stateChanges.some((c) => c.label.includes('Yield Pool'))).toBe(true);
  });

  it('should simulate successful invoice minting flow', async () => {
    const result = await simulation.simulateTransaction({
      flowType: 'INVOICE_MINTING',
      contractAddress: 'C_INVOICE_NFT_001',
      methodName: 'mint_invoice',
      args: { amount: 5000, invoiceId: 105 },
    });

    expect(result.success).toBe(true);
    expect(result.flowType).toBe('INVOICE_MINTING');
    expect(result.stateChanges.some((c) => c.label.includes('Credit Limit'))).toBe(true);
  });

  it('should block signing and return failure details when simulation fails', async () => {
    const result = await simulation.simulateTransaction({
      flowType: 'FUNDING',
      contractAddress: 'C_MARKETPLACE_001',
      methodName: 'fund_invoice',
      args: { shouldFail: true, failReason: 'Insufficient investor balance for transaction' },
    });

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe('Insufficient investor balance for transaction');
    expect(result.stateChanges.length).toBe(0);
  });
});
