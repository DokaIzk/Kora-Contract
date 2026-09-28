/**
 * Risk Pipeline — Entry point (internal tool/API surface)
 *
 * Exposes the pipeline for verifier tooling. Verifiers review the
 * `SuggestedScore` (score + confidence + breakdown) and then submit their own
 * judgment to `risk_registry` — the pipeline never submits on-chain itself.
 *
 * Issue #755
 */

export * from "./types";
export * from "./factors";
export * from "./formulas";
export * from "./scorer";

import { RiskPipeline } from "./scorer";

/** Convenience helper for verifier tooling: score with defaults. */
export function suggestScore(input: import("./types").ScoringInput, formulaVersion?: string) {
  return new RiskPipeline().score(input, formulaVersion);
}
