/**
 * Transaction Status Tracker Component (#776)
 * Reusable UI component tracking Soroban tx status with distinct failure messaging,
 * raw error drawer, and late-success reconciliation.
 */

import React, { useState } from 'react';
import { TxTrackerProps } from '../../types/txTracker';

export const TransactionStatusTracker: React.FC<TxTrackerProps> = ({ status, onRetry, onClose }) => {
  const [showDebug, setShowDebug] = useState(false);

  if (status.state === 'idle') return null;

  return (
    <div className="bg-white border rounded-xl p-5 shadow-lg max-w-lg mx-auto space-y-4">
      {/* Header & Status Indicator */}
      <div className="flex items-center space-x-3">
        {(status.state === 'simulating' || status.state === 'submitting' || status.state === 'pending') && (
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        )}

        {status.state === 'confirmed' && (
          <div className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center font-bold text-xs">
            ✓
          </div>
        )}

        {(status.state === 'failed' || status.state === 'timeout') && (
          <div className="w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center font-bold text-xs">
            !
          </div>
        )}

        <div className="flex-1">
          <h4 className="font-bold text-gray-900 capitalize text-sm">
            Status: {status.state} {status.isLateSuccess && '(Reconciled Late Success)'}
          </h4>
          <p className="text-xs text-gray-600 mt-0.5">{status.userFacingMessage}</p>
        </div>
      </div>

      {/* Tx Details */}
      {status.txHash && (
        <div className="bg-gray-50 p-3 rounded-lg text-xs font-mono space-y-1 text-gray-700">
          <p>Tx Hash: <span className="text-gray-900">{status.txHash}</span></p>
          {status.ledgerSequence && <p>Ledger: #{status.ledgerSequence}</p>}
        </div>
      )}

      {/* Failure Details & Debug Accordion */}
      {status.rawErrorDetails && (
        <div className="space-y-2">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-gray-500 hover:text-gray-800 underline font-semibold"
          >
            {showDebug ? 'Hide Raw Debug Error' : 'Show Raw Debug Error'}
          </button>
          {showDebug && (
            <pre className="bg-red-950 text-red-200 p-3 rounded-lg text-xs font-mono overflow-x-auto max-h-40">
              {status.rawErrorDetails}
            </pre>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end space-x-3 pt-2">
        {status.state === 'failed' && onRetry && (
          <button
            onClick={onRetry}
            className="bg-blue-600 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Retry Transaction
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="bg-gray-100 text-gray-700 text-xs font-semibold px-4 py-2 rounded-lg hover:bg-gray-200"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
};
