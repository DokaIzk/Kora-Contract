/**
 * Risk Pipeline — Scorer / pipeline entry point
 *
 * Combines pluggable factors with a versioned formula. Combination rule
 * (documented, stable across versions): renormalize configured weights over
 * non-missing factors, take the weighted mean, and compute overall confidence
 * as the weight-weighted mean of per-factor confidences. Sparse data therefore
 * degrades confidence without skewing the score toward an arbitrary default.
 *
 * Issue #755
 */

import { ScoringFactor, ScoringInput, SuggestedScore, FactorBreakdown, PipelineConfig } from "./types";
import { FormulaRegistry } from "./formulas";
import {
  PaymentHistoryFactor,
  InvoiceFrequencyFactor,
  DebtorConcentrationFactor,
  MacroTradeFactor,
} from "./factors";

export const DEFAULT_FACTORS: ScoringFactor[] = [
  new PaymentHistoryFactor(),
  new InvoiceFrequencyFactor(),
  new DebtorConcentrationFactor(),
  new MacroTradeFactor(),
];

export class RiskPipeline {
  private registry = new FormulaRegistry();

  constructor(
    private factors: ScoringFactor[] = DEFAULT_FACTORS,
    private config: PipelineConfig = {},
  ) {}

  /** Compute a suggested score. Never throws on sparse data. */
  score(input: ScoringInput, formulaVersion?: string): SuggestedScore {
    const version = formulaVersion ?? this.config.formulaVersion ?? this.registry.latest().version;
    const formula = this.registry.get(version);

    const breakdown: FactorBreakdown[] = [];
    let weightSum = 0;
    for (const factor of this.factors) {
      const configuredWeight = formula.weights[factor.id] ?? 0;
      const result = factor.evaluate(input);
      breakdown.push({
        factorId: factor.id,
        score: result.score,
        appliedWeight: 0, // filled after renormalization
        configuredWeight,
        confidence: result.confidence,
        missing: result.missing || configuredWeight === 0,
        rationale: result.rationale,
      });
      if (!result.missing && configuredWeight > 0) weightSum += configuredWeight;
    }

    // Renormalize: if every factor is missing/zero-weighted, fall back to a
    // neutral 50 with zero confidence rather than dividing by zero.
    let score = 50;
    let confidence = 0;
    const warnings: string[] = [];
    if (weightSum > 0) {
      score = 0;
      confidence = 0;
      for (const b of breakdown) {
        if (!b.missing) {
          b.appliedWeight = b.configuredWeight / weightSum;
          score += b.score * b.appliedWeight;
          confidence += b.confidence * b.appliedWeight;
        }
      }
      score = Math.max(0, Math.min(100, Math.round(score)));
    } else {
      warnings.push("NO_USABLE_FACTORS");
    }

    const missingCount = breakdown.filter((b) => b.missing).length;
    if (missingCount > 0) warnings.push("SPARSE_DATA");
    const minConfidence = this.config.minConfidence ?? 0.4;
    if (confidence < minConfidence) warnings.push("LOW_CONFIDENCE_NOT_RECOMMENDED");

    return {
      score,
      confidence: Math.round(confidence * 100) / 100,
      formulaVersion: version,
      breakdown,
      warnings,
      computedAt: Math.floor(Date.now() / 1000),
    };
  }

  listFormulaVersions(): string[] {
    return this.registry.listVersions();
  }
}
