/**
 * Service for SME Invoice Submission Wizard (#772)
 * Handles client-side validation matching contract bounds, draft persistence,
 * document IPFS pinning, and state transitions.
 */

import {
  InvoiceDetails,
  InvoiceValidationError,
  InvoiceWizardDraft,
  DocumentUpload,
  MintResult,
  WizardStep,
} from '../types/invoiceWizard';

const DRAFT_STORAGE_KEY = 'kora_invoice_wizard_draft';

export class InvoiceWizardService {
  /**
   * Validates invoice details against on-chain bounds enforced in contracts/invoice_nft/src/lib.rs
   */
  public static validateInvoiceDetails(details: InvoiceDetails): InvoiceValidationError[] {
    const errors: InvoiceValidationError[] = [];

    if (!details.debtorName || details.debtorName.trim().length === 0) {
      errors.push({ field: 'debtorName', message: 'Debtor name is required.' });
    }

    if (!details.debtorHash || details.debtorHash.trim().length < 8) {
      errors.push({ field: 'debtorHash', message: 'Debtor hash must be at least 8 characters.' });
    }

    if (details.amount <= 0n) {
      errors.push({ field: 'amount', message: 'Invoice amount must be strictly greater than 0.' });
    }

    const maxAllowedAmount = 10_000_000_000_000n; // $10M max single invoice bound
    if (details.amount > maxAllowedAmount) {
      errors.push({ field: 'amount', message: 'Invoice amount exceeds maximum allowed single invoice cap ($10,000,000).' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (details.dueDateTimestamp <= nowSeconds) {
      errors.push({ field: 'dueDateTimestamp', message: 'Due date must be in the future.' });
    }

    return errors;
  }

  /**
   * Simulates IPFS document upload & pinning service.
   * Isolated from on-chain minting so upload failures do not affect mint state.
   */
  public static async pinDocumentToIpfs(fileName: string, fileSizeBytes: number): Promise<DocumentUpload> {
    if (fileSizeBytes > 50 * 1024 * 1024) {
      throw new Error('File size exceeds maximum 50MB IPFS upload limit.');
    }

    // Generate mock deterministic IPFS CID
    const pseudoHash = Math.abs(fileName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)).toString(16);
    const cid = `QmKora${pseudoHash.padStart(32, '0')}`;

    return {
      fileName,
      fileSizeBytes,
      ipfsCid: cid,
      status: 'pinned',
    };
  }

  /**
   * Persists draft state to localStorage to prevent data loss on accidental navigation
   */
  public static saveDraft(draft: InvoiceWizardDraft): void {
    if (typeof localStorage !== 'undefined') {
      const serialized = JSON.stringify({
        ...draft,
        details: {
          ...draft.details,
          amount: draft.details.amount.toString(),
        },
        lastSavedAt: Date.now(),
      });
      localStorage.setItem(DRAFT_STORAGE_KEY, serialized);
    }
  }

  /**
   * Loads saved draft state from localStorage
   */
  public static loadDraft(): InvoiceWizardDraft | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        details: {
          ...parsed.details,
          amount: BigInt(parsed.details.amount),
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Clears saved draft from storage
   */
  public static clearDraft(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }

  /**
   * Simulates minting the invoice NFT on-chain
   */
  public static async mintInvoice(details: InvoiceDetails, cid: string): Promise<MintResult> {
    const validationErrors = this.validateInvoiceDetails(details);
    if (validationErrors.length > 0) {
      throw new Error(`Cannot mint: ${validationErrors[0].message}`);
    }

    if (!cid) {
      throw new Error('Cannot mint: Supporting document IPFS CID is required.');
    }

    const invoiceId = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

    return {
      invoiceId,
      txHash,
      mintedAt: Math.floor(Date.now() / 1000),
    };
  }
}
