/**
 * Service for SME Repayment Management Dashboard (#778)
 * Accrued late fee calculation matching contracts/financing_pool formula,
 * due date status classification, and full/partial repayment processing.
 */

import {
  OutstandingInvoice,
  InvoiceRepaymentDetails,
  RepaymentDueStatus,
  RepaymentExecutionResult,
} from '../types/repayment';

export class RepaymentService {
  /**
   * Calculates accrued late fees and due status matching on-chain contract logic.
   * Late Fee Formula: principalOwed * dailyLateFeeBps / 10000 * daysOverdue
   */
  public static calculateRepaymentDetails(
    invoice: OutstandingInvoice,
    currentTimestamp: number = Math.floor(Date.now() / 1000),
  ): InvoiceRepaymentDetails {
    const netPrincipal = invoice.principalOwed - invoice.repaidAmount;
    if (netPrincipal <= 0n) {
      return {
        invoiceId: invoice.invoiceId,
        principalOwed: 0n,
        accruedLateFee: 0n,
        totalAmountDue: 0n,
        daysOverdue: 0,
        status: 'Current',
      };
    }

    let daysOverdue = 0;
    let status: RepaymentDueStatus = 'Current';
    let accruedLateFee = 0n;

    if (currentTimestamp > invoice.dueDateTimestamp) {
      const secondsOverdue = currentTimestamp - invoice.dueDateTimestamp;
      daysOverdue = Math.ceil(secondsOverdue / 86400);

      // Late fee calculation matching on-chain contract math
      const dailyBps = BigInt(invoice.dailyLateFeeBps);
      accruedLateFee = (netPrincipal * dailyBps * BigInt(daysOverdue)) / 10000n;

      if (currentTimestamp <= invoice.gracePeriodEndTimestamp) {
        status = 'GracePeriod';
      } else {
        status = 'DefaultRisk';
      }
    }

    return {
      invoiceId: invoice.invoiceId,
      principalOwed: netPrincipal,
      accruedLateFee,
      totalAmountDue: netPrincipal + accruedLateFee,
      daysOverdue,
      status,
    };
  }

  /**
   * Validates partial/full repayment amounts against on-chain bounds.
   */
  public static validateRepaymentAmount(
    amountToPay: bigint,
    details: InvoiceRepaymentDetails,
  ): string | null {
    if (amountToPay <= 0n) {
      return 'Repayment amount must be strictly greater than 0.';
    }

    if (amountToPay > details.totalAmountDue) {
      return `Repayment amount (${amountToPay.toString()}) exceeds total amount due (${details.totalAmountDue.toString()}).`;
    }

    return null;
  }

  /**
   * Simulates executing full or partial repayment
   */
  public static async executeRepayment(
    invoice: OutstandingInvoice,
    amountToPay: bigint,
    currentTimestamp: number = Math.floor(Date.now() / 1000),
  ): Promise<RepaymentExecutionResult> {
    const details = this.calculateRepaymentDetails(invoice, currentTimestamp);
    const validationError = this.validateRepaymentAmount(amountToPay, details);
    if (validationError) {
      throw new Error(validationError);
    }

    const isFullRepayment = amountToPay >= details.totalAmountDue;
    const txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

    return {
      invoiceId: invoice.invoiceId,
      repaidAmount: amountToPay,
      isFullRepayment,
      txHash,
      repaidAt: currentTimestamp,
    };
  }
}
