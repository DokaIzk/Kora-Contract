/**
 * Feature Flag Service — Public Exports
 */

export { FlagStore } from "./store";
export { FeatureFlagService, AuditEmitter } from "./service";
export { evaluateFlag, evaluateAll, hashUser, computeRolloutBucket } from "./evaluate";
export { handleFlagsSnapshot, handleFlagsStream, handleDisableFlag, handleEnableFlag } from "./http";
export type {
  FeatureName,
  FeatureFlag,
  FlagEvaluation,
  FlagSnapshot,
  FlagChangeEvent,
  PercentageRule,
  AllowlistRule,
  DenylistRule,
  TargetingRule,
  FlagAuditEntry,
} from "./types";
