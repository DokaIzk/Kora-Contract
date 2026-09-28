# Risk Scoring Data Pipeline

**Issue #755 — Off-Chain Risk Scoring Data Pipeline**

Ingests external signals (SME transaction history, debtor payment history, macro
trade data) and computes a **suggested** risk score with an auditable breakdown
that verifiers review before submitting their own judgment to `risk_registry`.

Out of scope: verifier-facing UI (Frontend) and fully automated on-chain
submission — the pipeline never submits on-chain itself.

## Architecture

```
configured sources → ScoringInput → RiskPipeline.score(input, version)
                                        ├─ PaymentHistoryFactor
                                        ├─ InvoiceFrequencyFactor
                                        ├─ DebtorConcentrationFactor
                                        └─ MacroTradeFactor (v2+)
                                      → SuggestedScore {
                                          score, confidence,
                                          formulaVersion, breakdown[],
                                          warnings[], computedAt
                                        } → verifier review → risk_registry
```

- **Pluggable factors** implement `ScoringFactor` (`src/factors.ts`).
- **Versioned formulas** live in `src/formulas.ts` (`v1`, `v2`, immutable once
  registered via `FormulaRegistry`). Every output records `formulaVersion` so
  historical scores remain explainable.
- **Combination rule** (stable across versions): renormalize configured weights
  over non-missing factors, take the weighted mean; overall confidence is the
  weight-weighted mean of per-factor confidences.

## Sparse data

Missing factors return a neutral score with `confidence: 0` and `missing: true`.
Overall confidence degrades; `warnings` includes `SPARSE_DATA` and, below
`minConfidence` (default 0.4), `LOW_CONFIDENCE_NOT_RECOMMENDED`. An input with
no usable factors yields neutral `50` with `NO_USABLE_FACTORS`.

## Usage

```ts
import { RiskPipeline } from "@kora/risk-pipeline";

const pipeline = new RiskPipeline(); // default factors, latest formula
const suggestion = pipeline.score({
  sme: { repayments: [{ paidOnTime: true }], totalInvoices: 5, invoicesLast90d: 1, defaults: 0 },
  debtors: [{ debtorHash: "ab…", exposureShareBps: 10_000, avgDebtorScore: 30 }],
});
console.log(suggestion.score, suggestion.confidence, suggestion.breakdown);
```

## Testing

```bash
npm install
npm test   # 90% line/branch/function/statement coverage enforced
```

Covers sparse-data confidence degradation, versioned-formula backward
compatibility + immutability, and factor-breakdown correctness.
