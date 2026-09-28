import React, { useState } from 'react';
import { useTransactionSimulation } from '../../context/SimulationContext';
import { useI18n } from '../../context/LocaleContext';
import { SimulationResultView } from './SimulationResultView';

export const SimulationPreviewModal: React.FC = () => {
  const { activeSimulation, clearSimulation, confirmAndSign } = useTransactionSimulation();
  const { t } = useI18n();
  const [isSigning, setIsSigning] = useState<boolean>(false);
  const [signedTxHash, setSignedTxHash] = useState<string | null>(null);

  if (!activeSimulation) return null;

  const handleConfirm = async () => {
    setIsSigning(true);
    try {
      const { txHash } = await confirmAndSign();
      setSignedTxHash(txHash);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="simulation-modal-overlay fixed inset-0 z-50 overflow-y-auto bg-gray-900 bg-opacity-75 flex items-center justify-center p-4">
      <div className="simulation-modal w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 bg-gray-900 text-white flex justify-between items-center">
          <h3 className="text-base font-semibold">{t('sim.preview_title')}</h3>
          <button
            onClick={clearSimulation}
            className="text-gray-400 hover:text-white text-xl font-bold"
            aria-label="Close Simulation Modal"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {signedTxHash ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-2">🎉</div>
              <h4 className="text-base font-bold text-gray-900">Transaction Executed Successfully!</h4>
              <p className="text-xs text-gray-500 mt-1 font-mono break-all">{signedTxHash}</p>
              <button
                onClick={clearSimulation}
                className="mt-6 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <SimulationResultView simulation={activeSimulation} />

              {/* Action buttons */}
              <div className="mt-6 flex space-x-3">
                <button
                  onClick={clearSimulation}
                  disabled={isSigning}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-700 text-xs font-semibold rounded-xl hover:bg-gray-50 transition-colors"
                >
                  {t('sim.cancel')}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!activeSimulation.success || isSigning}
                  className={`flex-1 py-2.5 text-white text-xs font-semibold rounded-xl transition-colors ${
                    activeSimulation.success
                      ? 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-gray-300 cursor-not-allowed'
                  }`}
                >
                  {isSigning ? 'Signing...' : t('sim.confirm')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
