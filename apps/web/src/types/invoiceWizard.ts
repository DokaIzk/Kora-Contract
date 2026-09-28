/**
 * Type definitions for SME Invoice Submission Wizard (#772)
 */

export type WizardStep = 'details' | 'upload' | 'review' | 'mint' | 'confirmation';

export interface InvoiceDetails {
  debtorName: string;
  debtorHash: string;
  amount: bigint;
  currency: string;
  dueDateTimestamp: number;
  description: string;
}

export interface DocumentUpload {
  fileName: string;
  fileSizeBytes: number;
  ipfsCid: string | null;
  status: 'idle' | 'uploading' | 'pinned' | 'error';
  errorMessage?: string;
}

export interface InvoiceWizardDraft {
  step: WizardStep;
  details: InvoiceDetails;
  document: DocumentUpload;
  lastSavedAt: number;
}

export interface InvoiceValidationError {
  field: keyof InvoiceDetails;
  message: string;
}

export interface MintResult {
  invoiceId: string;
  txHash: string;
  mintedAt: number;
}
