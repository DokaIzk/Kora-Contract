import { ApiGateway, RateLimitedError } from "../src/gateway";
import { createMemoryStore } from "../src/store";
import { RateLimiter } from "../src/rateLimiter";

function seedStore() {
  return createMemoryStore({
    lastIndexedLedger: 12345,
    invoices: [
      { id: "1", sme: "SME_A", debtorHash: "h1", amount: "100", currency: "USDC", dueDate: 10, ipfsCid: "cid1", riskScore: 20, riskTier: "AAA", status: "Listed", createdAt: 1 },
      { id: "2", sme: "SME_A", debtorHash: "h2", amount: "200", currency: "USDC", dueDate: 11, ipfsCid: "cid2", riskScore: 70, riskTier: "B", status: "Funded", createdAt: 2 },
      { id: "3", sme: "SME_B", debtorHash: "h3", amount: "300", currency: "EURC", dueDate: 12, ipfsCid: "cid3", riskScore: 90, riskTier: "C", status: "Listed", createdAt: 3 },
    ],
    listings: [
      { invoiceId: "1", seller: "SME_A", askingPrice: "90", faceValue: "100", token: "USDC", fundedAmount: "10", fundingDeadline: 99, isActive: true },
      { invoiceId: "2", seller: "SME_A", askingPrice: "180", faceValue: "200", token: "USDC", fundedAmount: "200", fundingDeadline: 99, isActive: false },
    ],
    positions: [
      { investor: "INV_1", invoiceId: "1", contributed: "10", shareBps: 1000, yieldClaimed: "0" },
      { investor: "INV_2", invoiceId: "1", contributed: "20", shareBps: 2000, yieldClaimed: "0" },
    ],
    riskScores: [
      { subject: "SME_A", kind: "sme", score: 25, verifier: "V1", updatedAt: 5 },
      { subject: "h1", kind: "debtor", score: 40, verifier: "V1", updatedAt: 6 },
    ],
  });
}

describe("api-gateway (issue #753)", () => {
  test("invoices support filter combinations, sorting, and cursor pagination", () => {
    const gw = new ApiGateway(seedStore());
    const page1 = gw.queryInvoices(
      { sme: { eq: "SME_A" } },
      { limit: 1 },
      { apiKey: "k1", sortBy: "riskScore", sortDir: "desc" },
    );
    expect(page1.data).toHaveLength(1);
    expect(page1.data[0].id).toBe("2"); // higher risk first
    expect(page1.lastIndexedLedger).toBe(12345);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = gw.queryInvoices(
      { sme: { eq: "SME_A" } },
      { limit: 1, cursor: page1.nextCursor as string },
      { apiKey: "k1", sortBy: "riskScore", sortDir: "desc" },
    );
    expect(page2.data[0].id).toBe("1");
    expect(page2.nextCursor).toBeNull();

    // Filter combination: status + tier.
    const filtered = gw.queryInvoices(
      { status: { eq: "Listed" }, riskTier: { in: ["C"] } },
      {},
      { apiKey: "k1" },
    );
    expect(filtered.data.map((i) => i.id)).toEqual(["3"]);
  });

  test("listings, positions, risk scores query correctly with freshness field", () => {
    const gw = new ApiGateway(seedStore());
    expect(
      gw.queryListings({ isActive: true }, {}, { apiKey: "k" }).data.map((l) => l.invoiceId),
    ).toEqual(["1"]);
    expect(
      gw.queryPositions({ investor: { eq: "INV_2" } }, {}, { apiKey: "k" }).data,
    ).toHaveLength(1);
    const rs = gw.queryRiskScores({ kind: "debtor" }, {}, { apiKey: "k" });
    expect(rs.data).toHaveLength(1);
    expect(rs.lastIndexedLedger).toBe(12345);
  });

  test("rate-limit enforcement blocks over-budget keys and reset restores", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    limiter.registerKey("free-key", "free");
    const gw = new ApiGateway(seedStore(), limiter);
    // free tier = 60/min: exhaust it.
    for (let i = 0; i < 60; i++) {
      gw.queryInvoices({}, {}, { apiKey: "free-key" });
    }
    expect(() => gw.queryInvoices({}, {}, { apiKey: "free-key" })).toThrow(RateLimitedError);
    // Window elapses → budget restored.
    now += 60_000;
    expect(() => gw.queryInvoices({}, {}, { apiKey: "free-key" })).not.toThrow();
    // Explicit reset also restores.
    for (let i = 0; i < 60; i++) gw.queryInvoices({}, {}, { apiKey: "free-key" });
    limiter.reset("free-key");
    expect(() => gw.queryInvoices({}, {}, { apiKey: "free-key" })).not.toThrow();
  });

  test("unknown keys default to free tier; higher tiers allow more", () => {
    const limiter = new RateLimiter();
    limiter.registerKey("ent", "enterprise");
    const gw = new ApiGateway(seedStore(), limiter);
    for (let i = 0; i < 61; i++) {
      if (i < 60) gw.queryInvoices({}, {}, { apiKey: "anon" });
      else expect(() => gw.queryInvoices({}, {}, { apiKey: "anon" })).toThrow(RateLimitedError);
    }
    // enterprise budget is far larger — 61 requests must all pass.
    for (let i = 0; i < 61; i++) gw.queryInvoices({}, {}, { apiKey: "ent" });
  });
});
