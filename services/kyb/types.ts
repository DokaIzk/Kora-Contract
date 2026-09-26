/**
 * KYB Service — shared types
 *
 * Defines the data model for SME Know-Your-Business verification.
 * Sensitive document bytes are never stored in plain text; only encrypted
 * ciphertext and metadata are persisted.
 *
 * Issue: #762
 */

// ── Review Status ─────────────────────────────────────────────────────────────

export type KybStatus =
  | "pending"      // submitted, awaiting reviewer
  | "under_review" // claimed by a reviewer
  | "approved"     // reviewer approved; on-chain flag set
  | "rejected"     // reviewer rejected with reason
  | "appealed";    // SME appealed a rejection

// ── Document Types ────────────────────────────────────────────────────────────

export type DocumentType =
  | "registration_certificate"
  | "ownership_proof"
  | "tax_certificate"
  | "director_id"
  | "utility_bill";

// ── Core Models ───────────────────────────────────────────────────────────────

export interface KybDocument {
  id: string;
  type: DocumentType;
  /** Original filename — stored for display only. */
  filename: string;
  /** MIME type of the original file. */
  mimeType: string;
  /**
   * AES-256-GCM encrypted document bytes (base64).
   * The encryption key is stored separately in a secrets manager keyed by
   * `applicationId`.  Raw document bytes are never written to disk or DB.
   */
  encryptedContent: string;
  /** SHA-256 of the *original* plaintext bytes — used for integrity checks. */
  contentHash: string;
  uploadedAt: Date;
}

export interface KybApplication {
  id: string;
  /** Stellar address of the SME. */
  smeAddress: string;
  status: KybStatus;
  documents: KybDocument[];
  /** Reviewer who claimed this application (if any). */
  reviewerId?: string;
  reviewedAt?: Date;
  /** Human-readable rejection reason (required when status = "rejected"). */
  rejectionReason?: string;
  /**
   * Appeal text submitted by the SME.  Only present when status = "appealed".
   * Appeals re-enter the review queue as "pending".
   */
  appealText?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Relay / On-Chain ──────────────────────────────────────────────────────────

export interface OnChainRelayResult {
  /** Stellar transaction hash of the allowlist flag relay. */
  transactionHash: string;
  /** Ledger sequence at which the transaction was applied. */
  ledger: number;
}

// ── Service Inputs ────────────────────────────────────────────────────────────

export interface SubmitKybInput {
  smeAddress: string;
  documents: Array<{
    type: DocumentType;
    filename: string;
    mimeType: string;
    /** Raw document bytes (will be encrypted before storage). */
    content: Buffer;
  }>;
}

export interface ReviewDecisionInput {
  applicationId: string;
  reviewerId: string;
  decision: "approve" | "reject";
  rejectionReason?: string;
}

export interface AppealInput {
  applicationId: string;
  smeAddress: string;
  appealText: string;
}
