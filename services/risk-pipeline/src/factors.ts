/**
 * Risk Pipeline — Scoring-factor modules
 *
 * Each factor is pluggable via the `ScoringFactor` interface: pure functions of
 * `ScoringInput` returning a 0–100 risk score plus a 0–1 confidence indicator.
 * Missing/sparse data never throws — it returns `missing: true` with a neutral
 * score and zero confidence so the pipeline can renormalize weights.
 *
 * Issue #755
 */

import { ScoringFactor, ScoringInput } from "./types";

function clamp100(n: number): number {
  if (Number.isNaN(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Payment history: on-time ratio + default penalty. Higher late/default rate → higher risk. */
export class PaymentHistoryFactor implements ScoringFactor {
  readonly id = "payment_history" as const;
  describe(): string {
    return "SME repayment discipline: on-time ratio with a per-default penalty.";
  }
  evaluate(input: ScoringInput) {
    const repayments = input.sme?.repayments ?? [];
    const defaults = input.sme?.defaults ?? 0;
    if (repayments.length === 0 && defaults === 0) {
      return {
        score: 50,
        confidence: 0,
        missing: true,
        rationale: "no repayment or default history available",
      };
    }
    const total = repayments.length;
    const onTime = repayments.filter((r) => r.paidOnTime).length;
    const onTimeRatio = total > 0 ? onTime / total : 1;
    // Base risk inversely follows on-time ratio; each recorded default adds 8 pts.
    const score = clamp100((1 - onTimeRatio) * 100 + defaults * 8);
    // Confidence grows with sample size, capped at 1.0 for 20+ observations.
    const confidence = Math.min(1, (total + Math.min(defaults, 5)) / 20);
    return {
      score,
      confidence,
      missing: false,
      rationale: `${onTime}/${total} on-time, ${defaults} defaults`,
    };
  }
}

/** Invoice frequency: regular issuance signals operating health; dormancy is risky. */
export class InvoiceFrequencyFactor implements ScoringFactor {
  readonly id = "invoice_frequency" as const;
  describe(): string {
    return "SME activity cadence: trailing-90-day issuance vs lifetime volume.";
  }
  evaluate(input: ScoringInput) {
    const total = input.sme?.totalInvoices;
    const last90 = input.sme?.invoicesLast90d;
    if (total === undefined || last90 === undefined) {
      return {
        score: 50,
        confidence: 0,
        missing: true,
        rationale: "invoice frequency data unavailable",
      };
    }
    if (total <= 0) {
      return {
        score: 75,
        confidence: 0.3,
        missing: false,
        rationale: "no invoices ever minted (dormant SME)",
      };
    }
    // Expected ~1 invoice/month; fewer than 3 in 90d elevates risk.
    const cadence = last90 / 3;
    const score = clamp100(60 - cadence * 20 + (total < 5 ? 10 : 0));
    const confidence = Math.min(1, total / 10);
    return {
      score,
      confidence,
      missing: false,
      rationale: `${last90} invoices in 90d over ${total} lifetime`,
    };
  }
}

/** Debtor concentration: Herfindahl index over exposure shares; concentration is risky. */
export class DebtorConcentrationFactor implements ScoringFactor {
  readonly id = "debtor_concentration" as const;
  describe(): string {
    return "Debtor diversification: HHI over exposure shares plus debtor-score drag.";
  }
  evaluate(input: ScoringInput) {
    const debtors = input.debtors ?? [];
    if (debtors.length === 0) {
      return {
        score: 50,
        confidence: 0,
        missing: true,
        rationale: "no debtor exposure data",
      };
    }
    // HHI in 0–1: sum of squared shares.
    const hhi = debtors.reduce((acc, d) => {
      const s = Math.max(0, Math.min(10_000, d.exposureShareBps)) / 10_000;
      return acc + s * s;
    }, 0);
    // Single-debtor book (HHI=1) → 90; perfectly diversified → ~10.
    let score = clamp100(10 + hhi * 80);
    // Drag toward the worst known debtor score (avg of known scores weighted by share).
    const known = debtors.filter((d) => typeof d.avgDebtorScore === "number");
    if (known.length > 0) {
      const weighted =
        known.reduce(
          (acc, d) => acc + (d.avgDebtorScore as number) * (d.exposureShareBps / 10_000),
          0,
        ) / (known.reduce((acc, d) => acc + d.exposureShareBps, 0) / 10_000 || 1);
      score = clamp100(score * 0.6 + weighted * 0.4);
    }
    const confidence = Math.min(1, 0.4 + debtors.length / 10);
    const warnings = hhi > 0.5 ? " concentrated book" : " diversified book";
    return {
      score,
      confidence,
      missing: false,
      rationale: `HHI=${hhi.toFixed(3)} over ${debtors.length} debtors (${warnings.trim()})`,
    };
  }
}

/** Macro trade factor (v2+): corridor stress adds systematic risk. */
export class MacroTradeFactor implements ScoringFactor {
  readonly id = "macro_trade" as const;
  describe(): string {
    return "Systematic backdrop: country/sector stress index and FX volatility.";
  }
  evaluate(input: ScoringInput) {
    const stress = input.macro?.stressIndex;
    const fxVol = input.macro?.fxVolatilityBps;
    if (stress === undefined && fxVol === undefined) {
      return {
        score: 50,
        confidence: 0,
        missing: true,
        rationale: "no macro data configured",
      };
    }
    const stressPart = stress === undefined ? 50 : Math.max(0, Math.min(100, stress));
    const fxPart =
      fxVol === undefined ? 50 : Math.max(0, Math.min(100, fxVol / 100));
    const score = clamp100(stressPart * 0.7 + fxPart * 0.3);
    const confidence = stress === undefined || fxVol === undefined ? 0.5 : 0.9;
    return {
      score,
      confidence,
      missing: false,
      rationale: `stress=${stress ?? "n/a"} fxVolBps=${fxVol ?? "n/a"}`,
    };
  }
}
