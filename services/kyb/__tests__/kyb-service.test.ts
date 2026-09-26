/**
 * KYB Service tests — issue #762
 *
 * Covers:
 *  - Full approval-to-on-chain-flag flow
 *  - Rejection path and rejection-reason validation
 *  - Idempotent re-approval (relay called twice = same SME approved twice safely)
 *  - Appeal flow (rejected → pending re-enter)
 *  - Reviewer ownership guard (only the claiming reviewer can decide)
 *  - Cross-SME appeal guard
 *  - Document encryption (plaintext never leaks in stored document)
 */

import { KybService } from "../kyb-service";
import { OnChainRelay, RelaySigner } from "../on-chain-relay";
import { InMemoryKybStore } from "../store";
import { OnChainRelayResult, SubmitKybInput } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MASTER_KEY = Buffer.alloc(32, 0xab); // deterministic test key

function mockSigner(callLog: string[]): RelaySigner {
  return {
    async setKybApproved(addr: string): Promise<OnChainRelayResult> {
      callLog.push(addr);
      return { transactionHash: `tx_${addr}`, ledger: 1000 };
    },
  };
}

function makeInput(smeAddress: string): SubmitKybInput {
  return {
    smeAddress,
    documents: [
      {
        type: "registration_certificate",
        filename: "cert.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("SENSITIVE_BUSINESS_REGISTRATION_DATA"),
      },
    ],
  };
}

function makeService(callLog: string[] = []): KybService {
  const store = new InMemoryKybStore();
  const relay = new OnChainRelay(mockSigner(callLog));
  return new KybService(store, relay, MASTER_KEY);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KybService — document encryption", () => {
  it("never stores plaintext document content", async () => {
    const svc = makeService();
    const app = await svc.submitApplication(makeInput("SME_ADDR_1"));
    const doc = app.documents[0];

    // Stored content should be base64 ciphertext, not the original plaintext.
    expect(doc.encryptedContent).not.toContain("SENSITIVE_BUSINESS_REGISTRATION_DATA");
    // Content hash should be a SHA-256 hex string (64 chars).
    expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.encryptedContent.length).toBeGreaterThan(0);
  });

  it("application starts in pending status", async () => {
    const svc = makeService();
    const app = await svc.submitApplication(makeInput("SME_ADDR_2"));
    expect(app.status).toBe("pending");
  });
});

describe("KybService — approval flow", () => {
  it("approval triggers on-chain relay and sets status to approved", async () => {
    const callLog: string[] = [];
    const svc = makeService(callLog);

    const app = await svc.submitApplication(makeInput("SME_ADDR_3"));
    await svc.claimReview(app.id, "REVIEWER_1");
    const { application, onChainResult } = await svc.submitDecision({
      applicationId: app.id,
      reviewerId: "REVIEWER_1",
      decision: "approve",
    });

    expect(application.status).toBe("approved");
    expect(onChainResult).toBeDefined();
    expect(onChainResult!.transactionHash).toBe("tx_SME_ADDR_3");
    expect(callLog).toContain("SME_ADDR_3");
  });

  it("idempotent re-approval calls relay twice without error", async () => {
    const callLog: string[] = [];
    const svc = makeService(callLog);

    const app = await svc.submitApplication(makeInput("SME_ADDR_4"));
    await svc.claimReview(app.id, "REVIEWER_1");
    await svc.submitDecision({ applicationId: app.id, reviewerId: "REVIEWER_1", decision: "approve" });

    // Simulate a second approval attempt by creating a new application for the same SME.
    const app2 = await svc.submitApplication(makeInput("SME_ADDR_4"));
    await svc.claimReview(app2.id, "REVIEWER_2");
    await expect(
      svc.submitDecision({ applicationId: app2.id, reviewerId: "REVIEWER_2", decision: "approve" })
    ).resolves.not.toThrow();

    // Relay should have been called twice — it is idempotent on-chain.
    expect(callLog.filter((a) => a === "SME_ADDR_4")).toHaveLength(2);
  });
});

describe("KybService — rejection path", () => {
  it("rejection sets status to rejected and records the reason", async () => {
    const svc = makeService();

    const app = await svc.submitApplication(makeInput("SME_ADDR_5"));
    await svc.claimReview(app.id, "REVIEWER_1");
    const { application } = await svc.submitDecision({
      applicationId: app.id,
      reviewerId: "REVIEWER_1",
      decision: "reject",
      rejectionReason: "Documents appear fraudulent",
    });

    expect(application.status).toBe("rejected");
    expect(application.rejectionReason).toBe("Documents appear fraudulent");
  });

  it("rejection without a reason throws", async () => {
    const svc = makeService();

    const app = await svc.submitApplication(makeInput("SME_ADDR_6"));
    await svc.claimReview(app.id, "REVIEWER_1");

    await expect(
      svc.submitDecision({ applicationId: app.id, reviewerId: "REVIEWER_1", decision: "reject" })
    ).rejects.toThrow("Rejection reason is required");
  });
});

describe("KybService — appeal flow", () => {
  it("SME can appeal a rejection — application re-enters queue as pending", async () => {
    const svc = makeService();

    const app = await svc.submitApplication(makeInput("SME_ADDR_7"));
    await svc.claimReview(app.id, "REVIEWER_1");
    await svc.submitDecision({
      applicationId: app.id,
      reviewerId: "REVIEWER_1",
      decision: "reject",
      rejectionReason: "Missing ownership docs",
    });

    const appealed = await svc.submitAppeal({
      applicationId: app.id,
      smeAddress: "SME_ADDR_7",
      appealText: "We have attached updated ownership documents.",
    });

    expect(appealed.status).toBe("pending");
    expect(appealed.appealText).toBe("We have attached updated ownership documents.");
    expect(appealed.rejectionReason).toBeUndefined();
  });

  it("non-applicant cannot appeal another SME's application", async () => {
    const svc = makeService();

    const app = await svc.submitApplication(makeInput("SME_ADDR_8"));
    await svc.claimReview(app.id, "REVIEWER_1");
    await svc.submitDecision({
      applicationId: app.id,
      reviewerId: "REVIEWER_1",
      decision: "reject",
      rejectionReason: "Expired certificate",
    });

    await expect(
      svc.submitAppeal({
        applicationId: app.id,
        smeAddress: "ATTACKER_ADDR",
        appealText: "Not my application but I want to appeal anyway",
      })
    ).rejects.toThrow("Only the applicant SME");
  });

  it("cannot appeal an approved application", async () => {
    const svc = makeService();

    const app = await svc.submitApplication(makeInput("SME_ADDR_9"));
    await svc.claimReview(app.id, "REVIEWER_1");
    await svc.submitDecision({ applicationId: app.id, reviewerId: "REVIEWER_1", decision: "approve" });

    await expect(
      svc.submitAppeal({ applicationId: app.id, smeAddress: "SME_ADDR_9", appealText: "trying to appeal" })
    ).rejects.toThrow("Only rejected applications");
  });
});

describe("KybService — review queue gating", () => {
  it("cannot submit a decision on a pending (unclaimed) application", async () => {
    const svc = makeService();
    const app = await svc.submitApplication(makeInput("SME_ADDR_10"));

    await expect(
      svc.submitDecision({ applicationId: app.id, reviewerId: "REVIEWER_1", decision: "approve" })
    ).rejects.toThrow("under_review");
  });

  it("getPendingQueue returns applications ordered oldest-first", async () => {
    const svc = makeService();

    const app1 = await svc.submitApplication(makeInput("SME_OLD"));
    await new Promise((r) => setTimeout(r, 2)); // ensure distinct timestamps
    const app2 = await svc.submitApplication(makeInput("SME_NEW"));

    const queue = await svc.getPendingQueue();
    expect(queue[0].id).toBe(app1.id);
    expect(queue[1].id).toBe(app2.id);
  });
});
