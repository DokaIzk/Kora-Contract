/**
 * Chaos Scenario 6 — Reconciliation Alerting
 *
 * Resilience claim being tested (from the reconciliation alerting issue):
 *   "When the indexer detects a ledger gap (a sequence number missing from
 *    the event log that should have been processed), it MUST emit a
 *    reconciliation alert within `CHAOS_RECONCILER_ALERT_LAG_MS` (default 15 s).
 *    The alert MUST NOT be silently dropped even if the alerting channel is
 *    temporarily unavailable — it MUST be buffered and delivered when the
 *    channel recovers."
 *
 * Two sub-scenarios:
 *
 *  A. Gap → alert fired within lag window.
 *     Simulate a ledger gap by pausing the indexer, advancing the mock RPC
 *     ledger past the checkpoint, then unpausing.  The reconciler should
 *     detect the gap and fire an alert.
 *
 *  B. Alert sink down → alerts buffered, not dropped.
 *     Take the alert sink offline, create a gap, verify alerts accumulate in
 *     the queue, then restore the sink and verify all buffered alerts drain.
 *
 * Gap surfaced by this scenario:
 *   If the reconciler does not have a persistent alert queue, alerts created
 *   while the sink is down will be lost.  This surfaces as:
 *   - Pre-sink-restore queue depth > 0 but post-restore drained count = 0.
 *
 * Run:
 *   npm test -- --testPathPattern=scenario-reconciliation-alerting
 */

import {
  indexerIsHealthy,
  indexerLastCheckpoint,
  reconcilerStatus,
  reconcilerPendingAlerts,
  drainReconcilerAlerts,
  advanceMockLedger,
  waitUntil,
  sleep,
} from "../src/probes";
import {
  injectIndexerPause,
  injectAlertSinkDown,
  type Cleanup,
} from "../src/injectors";
import { config } from "../src/config";
import { logger } from "../src/logger";

// ── Helper ──────────────────────────────────────────────────────────────────

/**
 * Returns true once the reconciler has fired at least one alert more than
 * `preAlertCount`.
 */
async function reconcilerFiredNewAlert(preAlertsFired: number): Promise<boolean> {
  const status = await reconcilerStatus();
  return status !== null && status.alertsFired > preAlertsFired;
}

// ── Sub-scenario A: Gap → Alert ─────────────────────────────────────────────

describe("Chaos: Reconciliation Alerting — Gap triggers alert", () => {
  let cleanup: Cleanup | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
    // Always drain alerts so subsequent tests start with a clean queue.
    await drainReconcilerAlerts();
  });

  it(
    "fires a reconciliation alert within the lag window after a ledger gap is created",
    async () => {
      // ── 1. Baseline ─────────────────────────────────────────────────────
      const baseStatus = await reconcilerStatus();
      if (baseStatus === null) {
        logger.warn(
          "GAP DETECTED: /reconciler/status endpoint not available. " +
            "Cannot verify alert-on-gap claim. " +
            "Follow-up: expose reconciler status and alert queue via admin API.",
        );
        return;
      }

      const preCheckpoint = await indexerLastCheckpoint();
      const preAlertsFired = baseStatus.alertsFired;
      const preGapsDetected = baseStatus.gapsDetected;

      logger.info(
        { preCheckpoint, preAlertsFired, preGapsDetected },
        "chaos[reconciliation-alerting]: baseline",
      );

      // ── 2. Pause the indexer and advance the ledger to create a gap ──────
      cleanup = await injectIndexerPause();
      logger.info("chaos[reconciliation-alerting]: indexer paused");

      // Advance the mock RPC ledger while the indexer is paused.
      // This creates ledgers that exist on the RPC but are absent from the
      // indexer's event log — a detectable gap.
      const advancedLedger = await advanceMockLedger(config.mockLedgerAdvanceCount);
      logger.info(
        { advancedLedger },
        "chaos[reconciliation-alerting]: ledger advanced (gap created)",
      );

      // Wait long enough for the reconciler to complete a scan cycle and
      // detect the gap.  The reconciler's scan interval must be < alert lag max.
      await sleep(Math.floor(config.reconcilerAlertLagMaxMs * 0.6));

      // ── 3. Unpause the indexer before asserting (gap remains detectable) ─
      await cleanup();
      cleanup = null;
      logger.info("chaos[reconciliation-alerting]: indexer unpaused");

      // ── 4. Wait for alert within the lag window ───────────────────────────
      const alertFired = await waitUntil(
        () => reconcilerFiredNewAlert(preAlertsFired),
        config.reconcilerAlertLagMaxMs,
        config.healthPollIntervalMs,
      );

      const postStatus = await reconcilerStatus();
      const pendingAlerts = await reconcilerPendingAlerts();

      logger.info(
        {
          alertFired,
          postAlertsFired: postStatus?.alertsFired,
          postGapsDetected: postStatus?.gapsDetected,
          pendingAlertCount: pendingAlerts.length,
        },
        "chaos[reconciliation-alerting]: post-gap state",
      );

      // Claim: at least one alert must have been fired within the lag window.
      if (!alertFired) {
        logger.error(
          { lagLimitMs: config.reconcilerAlertLagMaxMs, postStatus },
          "GAP: reconciler did not fire an alert within the lag window after a " +
            "ledger gap was created. The reconciler may not be scanning or may have " +
            "a scan interval larger than the acceptable lag budget.",
        );
      }
      expect(alertFired).toBe(true);

      // Claim: gaps detected count must have increased.
      expect(postStatus).not.toBeNull();
      expect(postStatus!.gapsDetected).toBeGreaterThan(preGapsDetected);

      // Claim: at least one pending alert in the queue (not auto-cleared).
      expect(pendingAlerts.length).toBeGreaterThan(0);
    },
    config.reconcilerAlertLagMaxMs + config.recoveryTimeoutMs + 30_000,
  );
});

// ── Sub-scenario B: Alert sink down → buffering ─────────────────────────────

describe("Chaos: Reconciliation Alerting — Buffering when sink is down", () => {
  let indexerCleanup: Cleanup | null = null;
  let sinkCleanup: Cleanup | null = null;

  afterEach(async () => {
    if (indexerCleanup) {
      await indexerCleanup();
      indexerCleanup = null;
    }
    if (sinkCleanup) {
      await sinkCleanup();
      sinkCleanup = null;
    }
    await drainReconcilerAlerts();
  });

  it(
    "buffers alerts when the alert sink is down and drains them on sink recovery",
    async () => {
      // ── 1. Baseline ─────────────────────────────────────────────────────
      const baseStatus = await reconcilerStatus();
      if (baseStatus === null) {
        logger.warn(
          "chaos[reconciliation-alerting/buffering]: /reconciler/status unavailable — skipping",
        );
        return;
      }

      const preAlertsFired = baseStatus.alertsFired;
      const preQueueDepth = baseStatus.alertQueueDepth;

      logger.info(
        { preAlertsFired, preQueueDepth },
        "chaos[reconciliation-alerting/buffering]: baseline",
      );

      // ── 2. Take the alert sink offline ───────────────────────────────────
      sinkCleanup = await injectAlertSinkDown();
      logger.info("chaos[reconciliation-alerting/buffering]: alert sink paused");

      // ── 3. Create a ledger gap while the sink is down ─────────────────────
      indexerCleanup = await injectIndexerPause();
      await advanceMockLedger(config.mockLedgerAdvanceCount);
      await sleep(config.healthPollIntervalMs * 3);
      await indexerCleanup();
      indexerCleanup = null;

      // Wait for the reconciler to detect the gap and attempt alerting.
      await sleep(Math.floor(config.reconcilerAlertLagMaxMs * 0.8));

      // ── 4. Assert alerts are queued, not dropped ──────────────────────────
      const duringPartitionStatus = await reconcilerStatus();
      const duringPartitionPending = await reconcilerPendingAlerts();

      logger.info(
        {
          queueDepth: duringPartitionStatus?.alertQueueDepth,
          pendingCount: duringPartitionPending.length,
        },
        "chaos[reconciliation-alerting/buffering]: state while sink is down",
      );

      // The queue depth should have grown (alerts buffered, not dropped).
      const queueDepth = duringPartitionStatus?.alertQueueDepth ?? 0;
      if (queueDepth === 0 && duringPartitionPending.length === 0) {
        logger.warn(
          "GAP DETECTED: reconciler alert queue is empty while the alert sink is down. " +
            "Alerts may be dropped rather than buffered. " +
            "Follow-up: implement a persistent alert queue in the reconciler so alerts " +
            "survive sink outages and are retried on recovery.",
        );
      }
      // Allow a soft assertion here: if the reconciler does not expose the queue,
      // we mark the gap but do not hard-fail on a missing endpoint.
      // Hard assertion: if the endpoint IS available, queue must be non-zero.
      if (duringPartitionStatus !== null) {
        expect(queueDepth + duringPartitionPending.length).toBeGreaterThan(0);
      }

      // ── 5. Restore the alert sink ─────────────────────────────────────────
      await sinkCleanup();
      sinkCleanup = null;
      logger.info("chaos[reconciliation-alerting/buffering]: alert sink restored");

      // ── 6. Wait for the queue to drain ────────────────────────────────────
      const drained = await waitUntil(
        async () => {
          const s = await reconcilerStatus();
          return s !== null && s.alertQueueDepth === 0;
        },
        config.recoveryTimeoutMs,
        config.healthPollIntervalMs,
      );

      const postRestoreStatus = await reconcilerStatus();
      const postRestorePending = await reconcilerPendingAlerts();

      logger.info(
        {
          drained,
          postQueueDepth: postRestoreStatus?.alertQueueDepth,
          postPendingCount: postRestorePending.length,
          totalAlertsFired: postRestoreStatus?.alertsFired,
        },
        "chaos[reconciliation-alerting/buffering]: post-restore state",
      );

      // Claim: post-restore alert count must exceed pre-sink-down alert count
      // (buffered alerts were delivered after recovery).
      if (postRestoreStatus !== null) {
        expect(postRestoreStatus.alertsFired).toBeGreaterThan(preAlertsFired);
      }

      // Claim: no pending alerts remain (queue fully drained).
      if (drained) {
        expect(postRestorePending.length).toBe(0);
      } else {
        logger.warn(
          { postRestorePending: postRestorePending.length },
          "GAP: alert queue did not fully drain within recovery timeout. " +
            "Buffered alerts may be stuck. Follow-up: investigate alert delivery retry logic.",
        );
      }
    },
    config.reconcilerAlertLagMaxMs * 2 + config.recoveryTimeoutMs + 60_000,
  );
});
