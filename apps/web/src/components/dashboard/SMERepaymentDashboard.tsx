/**
 * SME Repayment Management Dashboard Component (#778)
 * Displays outstanding invoices, grace period status, accrued late fees,
 * and enables initiating full or partial repayments with transaction tracking.
 */

import React, { useState } from 'react';
import { OutstandingInvoice, InvoiceRepaymentDetails } from '../../types/repayment';
import { RepaymentService } from '../../services/repaymentService';
import { TransactionStatusTracker } from './TransactionStatusTracker';
import { TxStatusState } from '../../types/txTracker';
import { TxTrackerService } from '../../services/txTrackerService';

interface Props {
  initialInvoices?: OutstandingInvoice[];
}

const DEFAULT_INVOICES: OutstandingInvoice[] = [
  {
    invoiceId: 'INV-101',
    debtorName: 'Acme Logistics',
    principalOwed: 100_000_000n,
    currency: 'USDC',
    dueDateTimestamp: Math.floor(Date.now() / 1000) + 7 * 86400, // Due in 7 days
    gracePeriodEndTimestamp: Math.floor(Date.now() / 1000) + 14 * 86400,
    dailyLateFeeBps: 50, // 0.5% daily
    repaidAmount: 0n,
  },
  {
    invoiceId: 'INV-202',
    debtorName: 'Global Freight Services',
    principalOwed: 50_000_000n,
    currency: 'USDC',
    dueDateTimestamp: Math.floor(Date.now() / 1000) - 3 * 86400, // 3 days overdue
    gracePeriodEndTimestamp: Math.floor(Date.now() / 1000) + 4 * 86400, // 4 days remaining in grace
    dailyLateFeeBps: 50,
    repaidAmount: 0n,
  },
  {
    invoiceId: 'INV-303',
    debtorName: 'Atlas Wholesale',
    principalOwed: 80_000_000n,
    currency: 'USDC',
    dueDateTimestamp: Math.floor(Date.now() / 1000) - 20 * 86400, // 20 days overdue
    gracePeriodEndTimestamp: Math.floor(Date.now() / 1000) - 6 * 86400, // Past grace period!
    dailyLateFeeBps: 50,
    repaidAmount: 20_000_000n,
  },
];

export const SMERepaymentDashboard: React.FC<Props> = ({ initialInvoices = DEFAULT_INVOICES }) => {
  const [invoices, setInvoices] = useState<OutstandingInvoice[]>(initialInvoices);
  const [selectedInvoice, setSelectedInvoice] = useState<{
    invoice: OutstandingInvoice;
    details: InvoiceRepaymentDetails;
  } | null>(null);

  const [paymentAmountInput, setPaymentAmountInput] = useState<string>('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatusState>(TxTrackerService.createInitialState());

  const handleOpenRepayModal = (inv: OutstandingInvoice) => {
    const details = RepaymentService.calculateRepaymentDetails(inv);
    setSelectedInvoice({ invoice: inv, details });
    setPaymentAmountInput(details.totalAmountDue.toString());
    setPaymentError(null);
    setTxStatus(TxTrackerService.createInitialState());
  };

  const handleExecuteRepayment = async () => {
    if (!selectedInvoice) return;
    setPaymentError(null);

    const amountToPay = BigInt(paymentAmountInput || 0);
    const err = RepaymentService.validateRepaymentAmount(amountToPay, selectedInvoice.details);
    if (err) {
      setPaymentError(err);
      return;
    }

    setTxStatus(TxTrackerService.transitionToSimulating(txStatus));

    try {
      await new Promise((r) => setTimeout(r, 600)); // Simulate pre-flight check
      setTxStatus(TxTrackerService.transitionToSubmitting(txStatus));

      const result = await RepaymentService.executeRepayment(selectedInvoice.invoice, amountToPay);
      setTxStatus(TxTrackerService.transitionToPending(txStatus, result.txHash));

      await new Promise((r) => setTimeout(r, 1000)); // Simulate block confirmation
      setTxStatus(TxTrackerService.transitionToConfirmed(txStatus, 1289456));

      // Update invoice repaid amount in state
      setInvoices((prev) =>
        prev.map((i) =>
          i.invoiceId === selectedInvoice.invoice.invoiceId
            ? { ...i, repaidAmount: i.repaidAmount + amountToPay }
            : i,
        ),
      );
    } catch (e: any) {
      setTxStatus(TxTrackerService.transitionToFailure(txStatus, 'on_chain_execution_failed', e.message));
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-900">SME Repayment Management Dashboard</h2>

      {/* Invoice List */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {invoices.map((inv) => {
          const details = RepaymentService.calculateRepaymentDetails(inv);
          return (
            <div key={inv.invoiceId} className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-gray-900">{inv.debtorName}</h4>
                  <span className="text-xs font-mono text-gray-500">{inv.invoiceId}</span>
                </div>
                {details.status === 'Current' && (
                  <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded">Current</span>
                )}
                {details.status === 'GracePeriod' && (
                  <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded animate-pulse">
                    Grace Period ({details.daysOverdue}d overdue)
                  </span>
                )}
                {details.status === 'DefaultRisk' && (
                  <span className="bg-red-100 text-red-800 text-xs font-bold px-2.5 py-1 rounded">Default Risk!</span>
                )}
              </div>

              <div className="text-xs space-y-1 text-gray-600 bg-gray-50 p-3 rounded-lg">
                <p>Principal Owed: <span className="font-mono font-bold text-gray-900">{(Number(details.principalOwed) / 1e6).toFixed(2)} {inv.currency}</span></p>
                <p>Accrued Late Fee: <span className="font-mono text-red-600 font-bold">+{(Number(details.accruedLateFee) / 1e6).toFixed(2)}</span></p>
                <p className="border-t pt-1 font-bold text-gray-900">Total Due: {(Number(details.totalAmountDue) / 1e6).toFixed(2)} {inv.currency}</p>
              </div>

              {details.totalAmountDue > 0n ? (
                <button
                  onClick={() => handleOpenRepayModal(inv)}
                  className="w-full bg-blue-600 text-white font-semibold py-2 rounded-lg text-xs hover:bg-blue-700"
                >
                  Repay (Full or Partial)
                </button>
              ) : (
                <div className="text-center text-xs text-green-600 font-bold py-2 bg-green-50 rounded-lg">
                  ✓ Fully Paid
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Repayment Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-xl max-w-lg w-full space-y-4 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Initiate Repayment: {selectedInvoice.invoice.invoiceId}</h3>

            <div className="bg-gray-50 p-4 rounded-lg text-xs space-y-1 font-mono text-gray-700">
              <p>Debtor: {selectedInvoice.invoice.debtorName}</p>
              <p>Principal Balance: {(Number(selectedInvoice.details.principalOwed) / 1e6).toFixed(2)} {selectedInvoice.invoice.currency}</p>
              <p>Accrued Late Fees: +{(Number(selectedInvoice.details.accruedLateFee) / 1e6).toFixed(2)}</p>
              <p className="font-bold text-gray-900">Total Outstanding: {(Number(selectedInvoice.details.totalAmountDue) / 1e6).toFixed(2)} {selectedInvoice.invoice.currency}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Repayment Amount (Stroops / Base Units)</label>
              <input
                type="number"
                className="w-full border p-2 rounded-lg text-sm"
                value={paymentAmountInput}
                onChange={(e) => setPaymentAmountInput(e.target.value)}
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <button
                  onClick={() => setPaymentAmountInput((selectedInvoice.details.totalAmountDue / 2n).toString())}
                  className="text-blue-600 hover:underline"
                >
                  Pay 50% Partial
                </button>
                <button
                  onClick={() => setPaymentAmountInput(selectedInvoice.details.totalAmountDue.toString())}
                  className="text-blue-600 hover:underline font-bold"
                >
                  Pay 100% Full
                </button>
              </div>
            </div>

            {paymentError && <div className="text-red-600 text-xs bg-red-50 p-2 rounded">{paymentError}</div>}

            <TransactionStatusTracker status={txStatus} onClose={() => setSelectedInvoice(null)} />

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-xs text-gray-600 hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteRepayment}
                className="bg-green-600 text-white font-bold px-6 py-2 rounded-lg text-xs hover:bg-green-700"
              >
                Submit On-Chain Repayment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
