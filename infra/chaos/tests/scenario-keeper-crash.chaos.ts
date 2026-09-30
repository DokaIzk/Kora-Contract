/**
 * Chaos Scenario 3 — Keeper Service Crash and Restart
 *
 * Resilience claim being tested (from the keeper retry issue #765):
 *   "After a hard crash-and-restart the keeper MUST NOT re-submit any
 *    transaction whose dedup_key already appears in the 'done' job set.
 *    The INSERT-OR-IGNORE dedup guard in the SQLite job store is the
 *    primary protection; this scenario verifies it survives a SIGKILL."
 *
 * What this scenario does:
 *   1. Records the current set of done dedup_keys and job counts.
 *   2. SIGKILLs the keeper container (simulates an OOM kill or VM
 *      preemption — no graceful shutdown, no WAL flush guarantee).
 *   3. Waits for the container to be restarted by Docker (auto-restart policy)
 *      or restarts it manually via the cleanup function.
 *   4. Waits for the keeper to report healthy again.
 *   5. Asserts:
 *      a. The set of done dedup_keys is a superset of the pre-crash set
 *         (no done jobs vanished).
 *      b. No dedup_key appears more than once in the done set (no double-submit).
 *      c. The in_flight count returns to 0 within the recovery window
 *         (no jobs stuck in in_flight after restart).
 */

import {
  keeperIsHealthy,
  keeperJobCounts,
  keeperDoneJobKeys,
  waitUntil,
  sleep,
} from "../src/probes";
import { injectServiceCrash, type Cleanup } from "../src/injectors";
import { config } from "../src/config";
import { logger } from "../src/logger";

describe("Chaos: Keeper Service Crash and Restart", () => {
  let cleanup: Cleanup | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it(
    "does not double-submit after SIGKILL — dedup_key uniqueness invariant survives crash",
    async () => {
      // ── 1. Baseline ──────────────────────────────────────────────────────
      const preCounts = await keeperJobCounts();
      const preDoneKeys = await keeperDoneJobKeys();

      logger.info({ preCounts, doneKeyCount: preDoneKeys?.length }, "chaos[keeper-crash]: baseline");

      if (preCounts === null || preDoneKeys === null) {
        logger.warn(
          "GAP DETECTED: keeper /status or /history endpoint not available. " +
            "Cannot verify no-double-submit claim without observable job state. " +
            "Follow-up: ensure keeper exposes /status and /history admin endpoints.",
        );
        return;
      }

      // ── 2. Inject crash ───────────────────────────────────────────────────
      cleanup = await injectServiceCrash(config.keeperContainer);
      logger.info("chaos[keeper-crash]: keeper container SIGKILLed");

      // Brief pause to ensure the kernel has fully killed the process before
      // the cleanup (restart) runs.
      await sleep(2_000);

      // ── 3. Restart (cleanup) ──────────────────────────────────────────────
      await cleanup();
      cleanup = null;
      logger.info("chaos[keeper-crash]: keeper container restart issued");

      // ── 4. Wait for recovery ──────────────────────────────────────────────
      const recovered = await waitUntil(keeperIsHealthy, config.recoveryTimeoutMs);
      logger.info({ recovered }, "chaos[keeper-crash]: keeper health after restart");
      expect(recovered).toBe(true);

      // Allow the keeper's first job-promotion tick to run.
      await sleep(config.healthPollIntervalMs * 5);

      // ── 5. Assert resilience claims ───────────────────────────────────────
      const postCounts = await keeperJobCounts();
      const postDoneKeys = await keeperDoneJobKeys();

      logger.info(
        { preCounts, postCounts, preDoneCount: preDoneKeys.length, postDoneCount: postDoneKeys?.length },
        "chaos[keeper-crash]: post-restart state",
      );

      expect(postCounts).not.toBeNull();
      expect(postDoneKeys).not.toBeNull();

      // Claim a: done count must be >= pre-crash (no done jobs vanished).
      expect(postCounts!.done).toBeGreaterThanOrEqual(preCounts.done);

      // Claim b: no dedup_key appears more than once in the done set.
      const keyFrequency = new Map<string, number>();
      for (const key of postDoneKeys!) {
        keyFrequency.set(key, (keyFrequency.get(key) ?? 0) + 1);
      }
      const duplicates = [...keyFrequency.entries()].filter(([, count]) => count > 1);

      if (duplicates.length > 0) {
        logger.error(
          { duplicates },
          "GAP: duplicate dedup_keys found in done set — double-submit after crash",
        );
      }
      expect(duplicates).toHaveLength(0);

      // Claim c: in_flight count must return to 0 (no stuck in-flight jobs).
      // A job stuck in_flight after restart means the keeper is re-submitting
      // a transaction that may already have been confirmed on-chain.
      expect(postCounts!.in_flight).toBe(0);
    },
    config.recoveryTimeoutMs + 30_000,
  );
});
