/**
 * Type definitions for SME Repayment Management Dashboard (#778)
 */

export type RepaymentDueStatus = 'Current' | 'GracePeriod' | 'DefaultRisk';

export interface OutstandingInvoice {
  invoiceId: string;
  debtorName: string;
  principalOwed: bigint;
  currency: string;
  dueDateTimestamp: number;
  gracePeriodEndTimestamp: number;
  dailyLateFeeBps: number; // e.g. 50 = 0.5% daily
  repaidAmount: bigint;
}

export interface InvoiceRepaymentDetails {
  invoiceId: string;
  principalOwed: bigint;
  accruedLateFee: bigint;
  totalAmountDue: bigint;
  daysOverdue: number;
  status: RepaymentDueStatus;
}

export interface RepaymentExecutionResult {
  invoiceId: string;
  repaidAmount: bigint;
  isFullRepayment: boolean;
  txHash: string;
  repaidAt: number;
}
