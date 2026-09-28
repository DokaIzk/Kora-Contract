/**
 * Risk Scoring Data Pipeline — Types
 *
 * Ingests external signals (SME transaction history, debtor payment history,
 * macro trade data) and computes a *suggested* risk score that a human verifier
 * reviews before submitting anything to `risk_registry`. Fully automated
 * on-chain submission is explicitly out of scope.
 *
 * Issue #755
 */

/** Pluggable scoring-factor identifiers. */
export type ScoringFactorId =
  | "payment_history"
  | "invoice_frequency"
  | "debtor_concentration"
  | "macro_trade";

/** Raw signals ingested from configured data sources. All fields optional — the
 * pipeline must degrade gracefully (confidence) when data is sparse. */
export interface ScoringInput {
  /** SME-scoped signals. */
  sme?: {
    /** Per-invoice repayment outcomes, oldest first. */
    repayments?: Array<{ paidOnTime: boolean; daysLate?: number }>;
    /** Total invoices ever minted by this SME (on-chain count welcome). */
    totalInvoices?: number;
    /** Invoices minted in the trailing 90 days. */
    invoicesLast90d?: number;
    /** Recorded defaults. */
    defaults?: number;
  };
  /** Debtor-scoped signals, keyed by debtor hash (hex). */
  debtors?: Array<{
    debtorHash: string;
    exposureShareBps: number; // 0–10_000, should sum ≈ 10_000
    avgDebtorScore?: number; // 0–100 when known
    latePayments?: number;
    totalPayments?: number;
  }>;
  /** Macro trade context (optional; formula v2+). */
  macro?: {
    /** Country/sector stress index 0–100 (100 = severe stress). */
    stressIndex?: number;
    /** FX volatility (annualized bps) for the settlement corridor. */
    fxVolatilityBps?: number;
  };
}

/** Per-factor contribution to the final score. */
export interface FactorBreakdown {
  factorId: ScoringFactorId;
  /** Factor-level score 0–100 (higher = riskier, matching protocol convention). */
  score: number;
  /** Weight actually applied (renormalized when factors are missing). */
  appliedWeight: number;
  /** Configured weight before renormalization. */
  configuredWeight: number;
  /** 0–1 data-coverage indicator for this factor. */
  confidence: number;
  /** True when the factor had no usable input. */
  missing: boolean;
  /** Human-readable rationale (auditable). */
  rationale: string;
}

/** Suggested score returned to verifiers (review required before on-chain use). */
export interface SuggestedScore {
  /** Composite suggested score 0–100 (higher = riskier). */
  score: number;
  /** Overall confidence 0–1; degrades with sparse/missing data. */
  confidence: number;
  /** Versioned scoring formula used (historical scores remain explainable). */
  formulaVersion: string;
  /** Auditable per-factor breakdown. */
  breakdown: FactorBreakdown[];
  /** Machine-readable warnings (e.g. SPARSE_DATA, HIGH_CONCENTRATION). */
  warnings: string[];
  /** Unix seconds when computed. */
  computedAt: number;
}

/** A pluggable scoring-factor module. */
export interface ScoringFactor {
  readonly id: ScoringFactorId;
  /** Human-readable description of what the factor measures. */
  describe(): string;
  /** Compute a 0–100 risk contribution + confidence from the input. */
  evaluate(input: ScoringInput): { score: number; confidence: number; missing: boolean; rationale: string };
}

/** A versioned scoring formula: fixed weights + documented combination rule. */
export interface ScoringFormula {
  readonly version: string;
  /** Human-readable changelog vs the previous version. */
  readonly changelog: string;
  /** Configured weights per factor; must sum to 1. */
  readonly weights: Record<ScoringFactorId, number>;
}

export interface PipelineConfig {
  /** Formula version to use (default: latest). */
  formulaVersion?: string;
  /** Minimum confidence below which the score is flagged NOT_RECOMMENDED. */
  minConfidence?: number;
}
