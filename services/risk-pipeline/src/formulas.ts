/**
 * Risk Pipeline — Versioned scoring formulas
 *
 * Formulas are versioned so historical scores remain explainable: the pipeline
 * records `formulaVersion` on every output and keeps every prior version
 * registered. Weights must sum to 1. Missing factors are renormalized at
 * scoring time (see scorer.ts), never silently dropped.
 *
 * - v1 (initial): payment_history 0.50 / invoice_frequency 0.20 /
 *   debtor_concentration 0.30. Macro input ignored.
 * - v2 (macro-aware): payment_history 0.40 / invoice_frequency 0.15 /
 *   debtor_concentration 0.25 / macro_trade 0.20.
 *
 * Issue #755
 */

import { ScoringFactorId, ScoringFormula } from "./types";

export const FORMULA_V1: ScoringFormula = {
  version: "v1",
  changelog: "Initial composite: payment history dominates; macro ignored.",
  weights: {
    payment_history: 0.5,
    invoice_frequency: 0.2,
    debtor_concentration: 0.3,
    macro_trade: 0,
  },
};

export const FORMULA_V2: ScoringFormula = {
  version: "v2",
  changelog: "Macro-aware rebalance: adds macro_trade at 0.20, trims others proportionally.",
  weights: {
    payment_history: 0.4,
    invoice_frequency: 0.15,
    debtor_concentration: 0.25,
    macro_trade: 0.2,
  },
};

const ALL_IDS: ScoringFactorId[] = [
  "payment_history",
  "invoice_frequency",
  "debtor_concentration",
  "macro_trade",
];

export function validateFormula(formula: ScoringFormula): void {
  const sum = ALL_IDS.reduce((acc, id) => acc + (formula.weights[id] ?? 0), 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`Formula ${formula.version}: weights must sum to 1 (got ${sum})`);
  }
  for (const id of ALL_IDS) {
    const w = formula.weights[id];
    if (!(w >= 0 && w <= 1)) throw new Error(`Formula ${formula.version}: bad weight for ${id}`);
  }
}

export class FormulaRegistry {
  private formulas = new Map<string, ScoringFormula>();

  constructor(initial: ScoringFormula[] = [FORMULA_V1, FORMULA_V2]) {
    for (const f of initial) this.register(f);
  }

  register(formula: ScoringFormula): void {
    validateFormula(formula);
    // Version strings are immutable: re-registering the same version with
    // different weights is rejected to keep history explainable.
    const existing = this.formulas.get(formula.version);
    if (existing && JSON.stringify(existing.weights) !== JSON.stringify(formula.weights)) {
      throw new Error(`Formula version ${formula.version} is immutable`);
    }
    this.formulas.set(formula.version, formula);
  }

  get(version: string): ScoringFormula {
    const f = this.formulas.get(version);
    if (!f) throw new Error(`Unknown formula version: ${version}`);
    return f;
  }

  listVersions(): string[] {
    return [...this.formulas.keys()].sort();
  }

  latest(): ScoringFormula {
    const versions = this.listVersions();
    return this.formulas.get(versions[versions.length - 1]) as ScoringFormula;
  }
}
