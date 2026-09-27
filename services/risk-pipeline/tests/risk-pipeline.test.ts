import { RiskPipeline } from "../src/scorer";
import { FormulaRegistry, FORMULA_V1 } from "../src/formulas";
import { PaymentHistoryFactor } from "../src/factors";

describe("risk-pipeline (issue #755)", () => {
  test("factor breakdown is auditable and weights renormalize", () => {
    const pipeline = new RiskPipeline();
    const result = pipeline.score(
      {
        sme: {
          repayments: [{ paidOnTime: true }, { paidOnTime: false }, { paidOnTime: true }],
          defaults: 0,
          totalInvoices: 12,
          invoicesLast90d: 3,
        },
        debtors: [{ debtorHash: "ab".repeat(32), exposureShareBps: 10_000, avgDebtorScore: 30 }],
      },
      "v1",
    );
    expect(result.formulaVersion).toBe("v1");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    // v1 ignores macro_trade: applied weight must be 0 and flagged missing.
    const macro = result.breakdown.find((b) => b.factorId === "macro_trade");
    expect(macro?.appliedWeight).toBe(0);
    // Applied weights of usable factors sum to ~1.
    const appliedSum = result.breakdown.reduce((a, b) => a + b.appliedWeight, 0);
    expect(appliedSum).toBeCloseTo(1, 5);
    expect(result.breakdown.length).toBe(4);
  });

  test("sparse data degrades confidence instead of failing", () => {
    const pipeline = new RiskPipeline();
    const full = pipeline.score(
      {
        sme: {
          repayments: Array.from({ length: 20 }, () => ({ paidOnTime: true })),
          totalInvoices: 20,
          invoicesLast90d: 3,
          defaults: 0,
        },
        debtors: [
          { debtorHash: "a", exposureShareBps: 5000 },
          { debtorHash: "b", exposureShareBps: 5000 },
        ],
      },
      "v1",
    );
    const sparse = pipeline.score({}, "v1");
    expect(sparse.warnings).toContain("SPARSE_DATA");
    expect(sparse.confidence).toBeLessThan(full.confidence);
    expect(sparse.score).toBe(50); // neutral fallback
    expect(sparse.warnings).toContain("LOW_CONFIDENCE_NOT_RECOMMENDED");
  });

  test("versioned formulas are backward compatible and immutable", () => {
    const pipeline = new RiskPipeline();
    const v1 = pipeline.score(
      {
        sme: { repayments: [{ paidOnTime: true }], totalInvoices: 5, invoicesLast90d: 1, defaults: 0 },
        debtors: [{ debtorHash: "x", exposureShareBps: 10_000 }],
        macro: { stressIndex: 90 },
      },
      "v1",
    );
    const v2 = pipeline.score(
      {
        sme: { repayments: [{ paidOnTime: true }], totalInvoices: 5, invoicesLast90d: 1, defaults: 0 },
        debtors: [{ debtorHash: "x", exposureShareBps: 10_000 }],
        macro: { stressIndex: 90 },
      },
      "v2",
    );
    // v2 sees macro stress, v1 ignores it → v2 must score riskier here.
    expect(v2.score).toBeGreaterThan(v1.score);
    expect(pipeline.listFormulaVersions()).toEqual(["v1", "v2"]);

    const registry = new FormulaRegistry([FORMULA_V1]);
    expect(() =>
      registry.register({ ...FORMULA_V1, weights: { ...FORMULA_V1.weights, payment_history: 0.9, invoice_frequency: 0.05, debtor_concentration: 0.05, macro_trade: 0 } }),
    ).toThrow(/immutable/);
    expect(() => registry.get("v99")).toThrow(/Unknown formula/);
  });

  test("payment history penalizes defaults and rewards clean records", () => {
    const f = new PaymentHistoryFactor();
    const clean = f.evaluate({ sme: { repayments: [{ paidOnTime: true }, { paidOnTime: true }], defaults: 0 } });
    const bad = f.evaluate({ sme: { repayments: [{ paidOnTime: false }], defaults: 2 } });
    expect(clean.score).toBeLessThan(bad.score);
    const missing = f.evaluate({});
    expect(missing.missing).toBe(true);
    expect(missing.confidence).toBe(0);
  });
});
