/**
 * SME Invoice Submission Wizard Component (#772)
 * Multi-step guided wizard for submitting invoices, uploading docs to IPFS, and minting on-chain.
 */

import React, { useState, useEffect } from 'react';
import {
  WizardStep,
  InvoiceDetails,
  DocumentUpload,
  InvoiceValidationError,
  MintResult,
} from '../../types/invoiceWizard';
import { InvoiceWizardService } from '../../services/invoiceWizardService';

export const InvoiceSubmissionWizard: React.FC = () => {
  const [step, setStep] = useState<WizardStep>('details');
  const [details, setDetails] = useState<InvoiceDetails>({
    debtorName: '',
    debtorHash: '',
    amount: 0n,
    currency: 'USDC',
    dueDateTimestamp: Math.floor(Date.now() / 1000) + 30 * 86400, // +30 days
    description: '',
  });

  const [document, setDocument] = useState<DocumentUpload>({
    fileName: '',
    fileSizeBytes: 0,
    ipfsCid: null,
    status: 'idle',
  });

  const [validationErrors, setValidationErrors] = useState<InvoiceValidationError[]>([]);
  const [mintResult, setMintResult] = useState<MintResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const draft = InvoiceWizardService.loadDraft();
    if (draft) {
      setStep(draft.step);
      setDetails(draft.details);
      setDocument(draft.document);
    }
  }, []);

  const handleNextStep = () => {
    if (step === 'details') {
      const errors = InvoiceWizardService.validateInvoiceDetails(details);
      if (errors.length > 0) {
        setValidationErrors(errors);
        return;
      }
      setValidationErrors([]);
      setStep('upload');
    } else if (step === 'upload') {
      if (document.status !== 'pinned' || !document.ipfsCid) {
        setSubmitError('Please upload and pin a supporting document before proceeding.');
        return;
      }
      setSubmitError(null);
      setStep('review');
    } else if (step === 'review') {
      setStep('mint');
    }

    InvoiceWizardService.saveDraft({
      step,
      details,
      document,
      lastSavedAt: Date.now(),
    });
  };

  const handleDocumentUpload = async (file: { name: string; size: number }) => {
    setDocument({ fileName: file.name, fileSizeBytes: file.size, ipfsCid: null, status: 'uploading' });
    setSubmitError(null);

    try {
      const pinned = await InvoiceWizardService.pinDocumentToIpfs(file.name, file.size);
      setDocument(pinned);
    } catch (err: any) {
      setDocument({
        fileName: file.name,
        fileSizeBytes: file.size,
        ipfsCid: null,
        status: 'error',
        errorMessage: err.message || 'Upload failed',
      });
    }
  };

  const handleMintTransaction = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await InvoiceWizardService.mintInvoice(details, document.ipfsCid!);
      setMintResult(result);
      setStep('confirmation');
      InvoiceWizardService.clearDraft();
    } catch (err: any) {
      setSubmitError(err.message || 'Transaction submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-2xl mx-auto border border-gray-100">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">SME Invoice Submission Wizard</h2>

      {/* Stepper Progress Indicator */}
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        {(['details', 'upload', 'review', 'mint', 'confirmation'] as WizardStep[]).map((s, idx) => (
          <div key={s} className="flex items-center">
            <span
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                step === s
                  ? 'bg-blue-600 text-white'
                  : idx < ['details', 'upload', 'review', 'mint', 'confirmation'].indexOf(step)
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {idx + 1}
            </span>
            <span className="ml-2 text-xs font-semibold uppercase text-gray-500 hidden sm:inline">{s}</span>
          </div>
        ))}
      </div>

      {/* Step 1: Details */}
      {step === 'details' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Debtor Name</label>
            <input
              type="text"
              className="w-full border rounded-lg p-2 text-sm"
              value={details.debtorName}
              onChange={(e) => setDetails({ ...details, debtorName: e.target.value })}
              placeholder="e.g. AcroCorp Supplies"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Debtor Hash / Identifier</label>
            <input
              type="text"
              className="w-full border rounded-lg p-2 text-sm font-mono"
              value={details.debtorHash}
              onChange={(e) => setDetails({ ...details, debtorHash: e.target.value })}
              placeholder="0x89aef78c90b..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Amount (Stroops / Base Units)</label>
            <input
              type="number"
              className="w-full border rounded-lg p-2 text-sm"
              value={details.amount.toString()}
              onChange={(e) => setDetails({ ...details, amount: BigInt(e.target.value || 0) })}
            />
          </div>

          {validationErrors.length > 0 && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs space-y-1">
              {validationErrors.map((err, i) => (
                <p key={i}>• {err.message}</p>
              ))}
            </div>
          )}

          <button
            onClick={handleNextStep}
            className="w-full bg-blue-600 text-white font-medium py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Continue to Document Upload
          </button>
        </div>
      )}

      {/* Step 2: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Upload supporting document (PDF, PNG) to pin on IPFS.</p>

          <div className="border-2 border-dashed border-gray-300 p-6 text-center rounded-lg">
            <button
              onClick={() => handleDocumentUpload({ name: 'invoice_receipt.pdf', size: 1024 * 500 })}
              className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium px-4 py-2 rounded-lg text-sm"
            >
              Simulate File Selection
            </button>
          </div>

          {document.status === 'uploading' && <p className="text-sm text-blue-600">Pinning to IPFS...</p>}
          {document.status === 'pinned' && (
            <div className="bg-green-50 border border-green-200 p-3 rounded-lg text-xs text-green-800">
              ✓ Document pinned! CID: <span className="font-mono">{document.ipfsCid}</span>
            </div>
          )}
          {document.status === 'error' && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs">
              Upload Error: {document.errorMessage}
            </div>
          )}

          {submitError && <div className="text-red-600 text-xs">{submitError}</div>}

          <div className="flex justify-between">
            <button onClick={() => setStep('details')} className="text-sm text-gray-600 hover:underline">
              Back
            </button>
            <button
              onClick={handleNextStep}
              disabled={document.status !== 'pinned'}
              className="bg-blue-600 text-white font-medium px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Review Invoice
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-800">Review Invoice Submission</h3>
          <div className="bg-gray-50 p-4 rounded-lg text-sm space-y-2">
            <p><strong>Debtor:</strong> {details.debtorName} ({details.debtorHash})</p>
            <p><strong>Amount:</strong> {details.amount.toString()} base units</p>
            <p><strong>IPFS CID:</strong> {document.ipfsCid}</p>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep('upload')} className="text-sm text-gray-600 hover:underline">
              Back
            </button>
            <button
              onClick={handleNextStep}
              className="bg-blue-600 text-white font-medium px-6 py-2 rounded-lg hover:bg-blue-700"
            >
              Proceed to Minting Signature
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Mint */}
      {step === 'mint' && (
        <div className="space-y-4 text-center">
          <h3 className="font-semibold text-gray-800">Sign & Mint Invoice NFT</h3>
          <p className="text-sm text-gray-600">Click below to submit on-chain transaction.</p>

          {submitError && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs">{submitError}</div>}

          <button
            onClick={handleMintTransaction}
            disabled={isSubmitting}
            className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting to Soroban...' : 'Sign & Submit Mint Tx'}
          </button>
        </div>
      )}

      {/* Step 5: Confirmation */}
      {step === 'confirmation' && mintResult && (
        <div className="space-y-4 text-center">
          <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
            ✓
          </div>
          <h3 className="text-xl font-bold text-gray-900">Invoice Minted Successfully!</h3>
          <div className="bg-gray-50 p-4 rounded-lg text-xs font-mono text-left space-y-1">
            <p>Invoice ID: {mintResult.invoiceId}</p>
            <p>Tx Hash: {mintResult.txHash}</p>
            <p>Timestamp: {new Date(mintResult.mintedAt * 1000).toISOString()}</p>
          </div>
        </div>
      )}
    </div>
  );
};
