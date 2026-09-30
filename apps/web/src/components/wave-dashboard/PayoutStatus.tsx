/**
 * Payout Status Component
 * 
 * Displays payout status with on-chain transaction link when available.
 */

import React from 'react';
import type { PayoutStatus as PayoutStatusType } from '../../types/wave';

interface PayoutStatusProps {
  status: PayoutStatusType;
  amount: string | null;
  txHash: string | null;
  proposalId: number | null;
}

const STATUS_LABELS: Record<PayoutStatusType, string> = {
  none: 'No Payout',
  pending: 'Payout Pending',
  approved: 'Payout Approved',
  paid: 'Paid',
  declined: 'Declined',
};

const STATUS_ICONS: Record<PayoutStatusType, string> = {
  none: '⏸️',
  pending: '⏳',
  approved: '✅',
  paid: '💰',
  declined: '❌',
};

export const PayoutStatus: React.FC<PayoutStatusProps> = ({
  status,
  amount,
  txHash,
  proposalId,
}) => {
  const label = STATUS_LABELS[status];
  const icon = STATUS_ICONS[status];

  return (
    <div className={`payout-status payout-${status}`}>
      <div className="payout-header">
        <span className="payout-icon">{icon}</span>
        <span className="payout-label">{label}</span>
      </div>

      {amount && (
        <div className="payout-amount">
          <strong>{amount} USDC</strong>
        </div>
      )}

      {proposalId && (
        <div className="proposal-id">
          <small>Treasury Proposal #{proposalId}</small>
        </div>
      )}

      {txHash && (
        <div className="tx-link">
          <a
            href={`https://stellar.expert/explorer/public/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-hash-link"
          >
            View Transaction →
          </a>
          <code className="tx-hash">{txHash.substring(0, 16)}...</code>
        </div>
      )}

      {status === 'pending' && (
        <div className="payout-note">
          <small>Awaiting on-chain execution</small>
        </div>
      )}

      {status === 'declined' && (
        <div className="payout-note">
          <small>Work declined or ineligible</small>
        </div>
      )}
    </div>
  );
};
