/**
 * KYB Service — core business logic
 *
 * Orchestrates document ingestion, review workflow, and on-chain relay.
 *
 *  Flow:
 *    submitApplication  →  (pending)
 *    claimReview        →  (under_review)
 *    submitDecision     →  (approved | rejected)
 *      approved         →  on-chain relay → allowlist flag set
 *    submitAppeal       →  (pending)  ← re-enters queue
 *
 * Design decisions:
 *  - Documents are encrypted before any persistence call.
 *  - The on-chain relay is idempotent: re-approving a previously approved
 *    SME does not submit a duplicate transaction.
 *  - Appeal re-opens the review queue entry; the application ID is reused
 *    to preserve the audit trail.
 *
 * Issue: #762
 */

import * as crypto from "crypto";
import { encryptDocument } from "./encryption";
import { OnChainRelay } from "./on-chain-relay";
import { KybStore } from "./store";
import {
  AppealInput,
  KybApplication,
  KybDocument,
  OnChainRelayResult,
  ReviewDecisionInput,
  SubmitKybInput,
} from "./types";

export class KybService {
  constructor(
    private readonly store: KybStore,
    private readonly relay: OnChainRelay,
    private readonly encryptionKey: Buffer
  ) {}

  // ── Application submission ─────────────────────────────────────────────────

  /**
   * Creates a new KYB application for an SME.
   * All supplied documents are encrypted before storage.
   */
  async submitApplication(input: SubmitKybInput): Promise<KybApplication> {
    const now = new Date();
    const applicationId = crypto.randomUUID();

    const documents: KybDocument[] = input.documents.map((doc) => {
      const { encoded, contentHash } = encryptDocument(doc.content, this.encryptionKey);
      return {
        id: crypto.randomUUID(),
        type: doc.type,
        filename: doc.filename,
        mimeType: doc.mimeType,
        encryptedContent: encoded,
        contentHash,
        uploadedAt: now,
      };
    });

    const application: KybApplication = {
      id: applicationId,
      smeAddress: input.smeAddress,
      status: "pending",
      documents,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(application);
    return application;
  }

  // ── Review queue ───────────────────────────────────────────────────────────

  /** Returns applications awaiting review, oldest first. */
  async getPendingQueue(): Promise<KybApplication[]> {
    return this.store.findPendingQueue();
  }

  /**
   * Claims an application for review — transitions it to `under_review`.
   * Prevents two reviewers from simultaneously working on the same application.
   */
  async claimReview(applicationId: string, reviewerId: string): Promise<KybApplication> {
    const app = await this._requireApplication(applicationId);
    if (app.status !== "pending" && app.status !== "appealed") {
      throw new Error(`Application ${applicationId} is not pending (status: ${app.status})`);
    }
    const updated: KybApplication = {
      ...app,
      status: "under_review",
      reviewerId,
      updatedAt: new Date(),
    };
    await this.store.save(updated);
    return updated;
  }

  // ── Review decision ────────────────────────────────────────────────────────

  /**
   * Records a reviewer's approve/reject decision.
   *
   * On approval:
   *  - Triggers the on-chain relay to set the allowlist flag.
   *  - Returns the on-chain transaction hash in the audit record.
   *
   * On rejection:
   *  - Stores the rejection reason.
   *  - The SME may appeal (see `submitAppeal`).
   *
   * @returns  Updated application.  For approvals, `onChainResult` is set.
   */
  async submitDecision(input: ReviewDecisionInput): Promise<{
    application: KybApplication;
    onChainResult?: OnChainRelayResult;
  }> {
    const app = await this._requireApplication(input.applicationId);

    if (app.status !== "under_review") {
      throw new Error(
        `Application ${input.applicationId} must be under_review to submit a decision (status: ${app.status})`
      );
    }

    if (input.decision === "reject" && !input.rejectionReason?.trim()) {
      throw new Error("Rejection reason is required");
    }

    let onChainResult: OnChainRelayResult | undefined;
    const now = new Date();

    if (input.decision === "approve") {
      // Already approved on-chain — relay is idempotent, safe to call again.
      onChainResult = await this.relay.approveOnChain(app.smeAddress);
    }

    const updated: KybApplication = {
      ...app,
      status: input.decision === "approve" ? "approved" : "rejected",
      reviewerId: input.reviewerId,
      reviewedAt: now,
      rejectionReason: input.decision === "reject" ? input.rejectionReason : undefined,
      updatedAt: now,
    };

    await this.store.save(updated);
    return { application: updated, onChainResult };
  }

  // ── Appeals ────────────────────────────────────────────────────────────────

  /**
   * Allows an SME to appeal a rejection.
   * The application re-enters the review queue as `pending`.
   * Appeal text is appended to the existing record for the audit trail.
   */
  async submitAppeal(input: AppealInput): Promise<KybApplication> {
    const app = await this._requireApplication(input.applicationId);

    if (app.smeAddress !== input.smeAddress) {
      throw new Error("Only the applicant SME may appeal their own application");
    }

    if (app.status !== "rejected") {
      throw new Error(
        `Only rejected applications can be appealed (status: ${app.status})`
      );
    }

    if (!input.appealText?.trim()) {
      throw new Error("Appeal text is required");
    }

    const updated: KybApplication = {
      ...app,
      status: "pending",
      appealText: input.appealText,
      // Clear the previous reviewer so it can be claimed fresh.
      reviewerId: undefined,
      reviewedAt: undefined,
      rejectionReason: undefined,
      updatedAt: new Date(),
    };

    await this.store.save(updated);
    return updated;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async getApplication(id: string): Promise<KybApplication | undefined> {
    return this.store.findById(id);
  }

  async getApplicationsBySme(smeAddress: string): Promise<KybApplication[]> {
    return this.store.findBySmeAddress(smeAddress);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _requireApplication(id: string): Promise<KybApplication> {
    const app = await this.store.findById(id);
    if (!app) throw new Error(`KYB application not found: ${id}`);
    return app;
  }
}
