/**
 * Tests for SME Invoice Submission Wizard (#772)
 */

import { InvoiceWizardService } from '../src/services/invoiceWizardService';
import { InvoiceDetails } from '../src/types/invoiceWizard';

describe('SME Invoice Submission Wizard Tests (#772)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('validates invoice details against contract bounds', () => {
    const invalidDetails: InvoiceDetails = {
      debtorName: '',
      debtorHash: 'short',
      amount: 0n,
      currency: 'USDC',
      dueDateTimestamp: Math.floor(Date.now() / 1000) - 1000,
      description: '',
    };

    const errors = InvoiceWizardService.validateInvoiceDetails(invalidDetails);
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.some((e) => e.field === 'debtorName')).toBe(true);
    expect(errors.some((e) => e.field === 'debtorHash')).toBe(true);
    expect(errors.some((e) => e.field === 'amount')).toBe(true);
    expect(errors.some((e) => e.field === 'dueDateTimestamp')).toBe(true);
  });

  it('accepts valid invoice details', () => {
    const validDetails: InvoiceDetails = {
      debtorName: 'Acme Logistics',
      debtorHash: '0x1234567890abcdef',
      amount: 50_000_000n,
      currency: 'USDC',
      dueDateTimestamp: Math.floor(Date.now() / 1000) + 86400 * 30,
      description: 'Q3 Freight Invoice',
    };

    const errors = InvoiceWizardService.validateInvoiceDetails(validDetails);
    expect(errors.length).toBe(0);
  });

  it('pins document to IPFS independently', async () => {
    const document = await InvoiceWizardService.pinDocumentToIpfs('bill_of_lading.pdf', 1024 * 100);
    expect(document.status).toBe('pinned');
    expect(document.ipfsCid).toMatch(/^QmKora/);
  });

  it('saves and loads draft state accurately', () => {
    const draft = {
      step: 'upload' as const,
      details: {
        debtorName: 'Acme',
        debtorHash: '0x1234567890',
        amount: 100n,
        currency: 'USDC',
        dueDateTimestamp: 2000000000,
        description: '',
      },
      document: {
        fileName: 'test.pdf',
        fileSizeBytes: 500,
        ipfsCid: 'QmTest',
        status: 'pinned' as const,
      },
      lastSavedAt: Date.now(),
    };

    InvoiceWizardService.saveDraft(draft);
    const loaded = InvoiceWizardService.loadDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.step).toBe('upload');
    expect(loaded?.details.amount).toBe(100n);
  });
});
