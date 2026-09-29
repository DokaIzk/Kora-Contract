/**
 * Tests for SME Repayment Management Dashboard (#778)
 */

import { RepaymentService } from '../src/services/repaymentService';
import { OutstandingInvoice } from '../src/types/repayment';

describe('SME Repayment Management Dashboard Tests (#778)', () => {
  const mockCurrentTime = 1700000000;

  const currentInvoice: OutstandingInvoice = {
    invoiceId: 'INV-001',
    debtorName: 'Acme Corp',
    principalOwed: 100_000_000n,
    currency: 'USDC',
    dueDateTimestamp: mockCurrentTime + 86400 * 5, // Due in 5 days
    gracePeriodEndTimestamp: mockCurrentTime + 86400 * 12,
    dailyLateFeeBps: 50,
    repaidAmount: 0n,
  };

  const gracePeriodInvoice: OutstandingInvoice = {
    invoiceId: 'INV-002',
    debtorName: 'Beta Logistics',
    principalOwed: 100_000_000n,
    currency: 'USDC',
    dueDateTimestamp: mockCurrentTime - 86400 * 4, // 4 days overdue
    gracePeriodEndTimestamp: Math.floor(mockCurrentTime + 86400 * 3), // inside grace
    dailyLateFeeBps: 50, // 0.5% daily
    repaidAmount: 0n,
  };

  it('calculates status as Current with zero late fee when not overdue', () => {
    const details = RepaymentService.calculateRepaymentDetails(currentInvoice, mockCurrentTime);
    expect(details.status).toBe('Current');
    expect(details.accruedLateFee).toBe(0n);
    expect(details.totalAmountDue).toBe(100_000_000n);
  });

  it('calculates accrued late fee accurately during grace period', () => {
    // 4 days overdue * 50 bps (0.5%) daily = 2% total late fee on 100,000,000 = 2,000,000
    const details = RepaymentService.calculateRepaymentDetails(gracePeriodInvoice, mockCurrentTime);
    expect(details.status).toBe('GracePeriod');
    expect(details.daysOverdue).toBe(4);
    expect(details.accruedLateFee).toBe(2_000_000n);
    expect(details.totalAmountDue).toBe(102_000_000n);
  });

  it('validates partial and full repayment bounds correctly', () => {
    const details = RepaymentService.calculateRepaymentDetails(gracePeriodInvoice, mockCurrentTime);

    expect(RepaymentService.validateRepaymentAmount(0n, details)).not.toBeNull();
    expect(RepaymentService.validateRepaymentAmount(105_000_000n, details)).not.toBeNull(); // exceeds total due
    expect(RepaymentService.validateRepaymentAmount(50_000_000n, details)).toBeNull(); // 50% partial OK
    expect(RepaymentService.validateRepaymentAmount(102_000_000n, details)).toBeNull(); // 100% full OK
  });

  it('executes repayment transaction successfully', async () => {
    const result = await RepaymentService.executeRepayment(gracePeriodInvoice, 50_000_000n, mockCurrentTime);
    expect(result.repaidAmount).toBe(50_000_000n);
    expect(result.isFullRepayment).toBe(false);
    expect(result.txHash).toMatch(/^0x/);
  });
});
