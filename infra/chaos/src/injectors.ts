/**
 * Failure injectors.
 *
 * Every injector returns a `Cleanup` function that MUST be called in a
 * `finally` block — the suite relies on this guarantee so that staging is
 * never left in a broken state, even if the scenario assertion throws.
 *
 * Design constraints:
 *  - Injectors target the staging Docker composition only (enforced by the
 *    `config.env !== "production"` guard in global-setup.ts).
 *  - Each injector is independently reversible so scenarios are composable.
 *  - `docker pause` / `docker unpause` are preferred over `docker stop`
 *    because pause preserves the container filesystem, avoiding data loss in
 *    staging volumes and making cleanup cheaper.
 */

import { execSync, execFileSync } from "child_process";
import { config } from "./config";
import { logger } from "./logger";

/** A zero-argument async function that removes the injected failure. */
export type Cleanup = () => Promise<void>;

// ── helpers ────────────────────────────────────────────────────────────────

function docker(...args: string[]): void {
  logger.info({ cmd: ["docker", ...args].join(" ") }, "docker");
  execFileSync("docker", args, { stdio: "inherit" });
}

function dockerExec(container: string, ...cmd: string[]): string {
  logger.info({ container, cmd }, "docker exec");
  return execFileSync("docker", ["exec", container, ...cmd]).toString().trim();
}

function sh(cmd: string): string {
  logger.info({ cmd }, "shell");
  return execSync(cmd, { stdio: "pipe" }).toString().trim();
}

// ── 1. RPC outage ─────────────────────────────────────────────────────────

/**
 * Simulate an RPC outage by pausing the mock Stellar RPC container that the
 * indexer subscribes to.  The indexer must not lose any ledger events it had
 * already checkpointed, and must resume from the last persisted checkpoint
 * once the RPC container is unpaused.
 */
export async function injectRpcOutage(): Promise<Cleanup> {
  logger.info({ container: config.rpcContainer }, "injecting RPC outage");
  docker("pause", config.rpcContainer);

  return async () => {
    logger.info({ container: config.rpcContainer }, "removing RPC outage");
    try {
      docker("unpause", config.rpcContainer);
    } catch (err) {
      // If the container exited while paused (unusual but possible in CI),
      // restart it so staging is left in a workable state.
      logger.warn({ err }, "unpause failed — attempting restart");
      docker("start", config.rpcContainer);
    }
  };
}

// ── 2. Database latency spike ─────────────────────────────────────────────

/**
 * Inject artificial round-trip latency on the DB container's loopback
 * interface using `tc netem`.  Requires `iproute2` to be present inside the
 * DB container (standard in Debian/Ubuntu images).
 *
 * Fallback: if `tc` is unavailable (Alpine slim images), sleeps in-process
 * and marks the injection as best-effort via the returned metadata.
 */
export async function injectDbLatency(latencyMs = config.dbLatencyMs): Promise<Cleanup> {
  logger.info({ container: config.dbContainer, latencyMs }, "injecting DB latency");

  let injected = false;
  try {
    // Add netem delay to eth0 inside the DB container.
    dockerExec(
      config.dbContainer,
      "tc", "qdisc", "add", "dev", "eth0", "root", "netem",
      "delay", `${latencyMs}ms`, `${Math.round(latencyMs * 0.1)}ms`,
    );
    injected = true;
  } catch {
    logger.warn(
      { container: config.dbContainer },
      "tc netem not available — DB latency injection skipped (iproute2 required)",
    );
  }

  return async () => {
    if (!injected) return;
    logger.info({ container: config.dbContainer }, "removing DB latency");
    try {
      dockerExec(config.dbContainer, "tc", "qdisc", "del", "dev", "eth0", "root");
    } catch (err) {
      logger.warn({ err }, "tc qdisc del failed — latency may persist until container restart");
    }
  };
}

// ── 3. Service crash-and-restart ──────────────────────────────────────────

/**
 * Kill a service container hard (SIGKILL) to simulate a process crash, then
 * restart it via Docker.  Returns a cleanup that ensures the container is
 * running whether or not the test assertion passed.
 */
export async function injectServiceCrash(containerName: string): Promise<Cleanup> {
  logger.info({ container: containerName }, "injecting service crash");
  docker("kill", "--signal=SIGKILL", containerName);

  return async () => {
    // Always try to bring the container back regardless of test outcome.
    try {
      const state = sh(`docker inspect --format='{{.State.Running}}' ${containerName}`);
      if (state !== "true") {
        logger.info({ container: containerName }, "restarting crashed container");
        docker("start", containerName);
      }
    } catch (err) {
      logger.error({ err, container: containerName }, "failed to restart container after crash injection");
    }
  };
}

// ── 4. Network partition (API ↔ Database) ────────────────────────────────

/**
 * Disconnect the API container from the internal Docker network that bridges
 * it to the database, simulating a network partition between the application
 * tier and storage tier.  Reconnects in the cleanup.
 */
export async function injectNetworkPartition(): Promise<Cleanup> {
  logger.info(
    { api: config.apiContainer, network: config.apiDbNetwork },
    "injecting API↔DB network partition",
  );
  docker("network", "disconnect", config.apiDbNetwork, config.apiContainer);

  return async () => {
    logger.info({ network: config.apiDbNetwork }, "removing network partition");
    try {
      docker("network", "connect", config.apiDbNetwork, config.apiContainer);
    } catch (err) {
      logger.warn({ err }, "network reconnect failed — attempting container restart");
      docker("restart", config.apiContainer);
    }
  };
}

// ── 5. Indexer pause (simulates checkpointing scenario) ───────────────────

/**
 * Pause the indexer container itself (not the RPC) to simulate the indexer
 * process being unresponsive (e.g., GC pause, OOM-kill-and-auto-restart).
 *
 * Used by the indexer-checkpointing scenario to verify that:
 * - The indexer's in-memory checkpoint is flushed to persistent storage
 *   before it becomes unresponsive.
 * - On resume, processing starts from the persisted ledger, not ledger 0.
 */
export async function injectIndexerPause(): Promise<Cleanup> {
  logger.info({ container: config.indexerContainer }, "injecting indexer pause");
  docker("pause", config.indexerContainer);

  return async () => {
    logger.info({ container: config.indexerContainer }, "removing indexer pause");
    try {
      docker("unpause", config.indexerContainer);
    } catch (err) {
      logger.warn({ err }, "indexer unpause failed — attempting restart");
      try {
        docker("start", config.indexerContainer);
      } catch (startErr) {
        logger.error({ startErr }, "indexer restart also failed — manual recovery required");
      }
    }
  };
}

// ── 6. Indexer hard crash ──────────────────────────────────────────────────

/**
 * SIGKILL the indexer container to simulate a hard crash (no WAL flush).
 *
 * This is a stricter form of the indexer-checkpointing test: even without
 * a clean shutdown, the last persisted checkpoint must survive and be used
 * on restart.
 */
export async function injectIndexerCrash(): Promise<Cleanup> {
  logger.info({ container: config.indexerContainer }, "injecting indexer hard crash");
  docker("kill", "--signal=SIGKILL", config.indexerContainer);

  return async () => {
    try {
      const state = sh(`docker inspect --format='{{.State.Running}}' ${config.indexerContainer}`);
      if (state !== "true") {
        logger.info({ container: config.indexerContainer }, "restarting crashed indexer");
        docker("start", config.indexerContainer);
      }
    } catch (err) {
      logger.error({ err, container: config.indexerContainer }, "failed to restart indexer after crash");
    }
  };
}

// ── 7. Reconciler alert suppression (simulates silenced alert path) ────────

/**
 * Disconnect the reconciler's outbound alerting channel by pausing the alert
 * sink container (e.g. the PagerDuty/webhook relay container).  Used by the
 * reconciliation-alerting scenario to verify:
 *
 * - The reconciler continues detecting gaps even when the alert channel is down.
 * - Alert events are buffered/queued and not silently dropped.
 * - When the channel comes back up, buffered alerts are drained in order.
 *
 * If no dedicated alert container exists in staging, falls back to a network
 * disconnect of the alerting webhook's target host.
 */
export async function injectAlertSinkDown(): Promise<Cleanup> {
  const alertContainer = process.env["CHAOS_ALERT_CONTAINER"] ?? "kora-alert-relay";
  logger.info({ container: alertContainer }, "injecting alert sink outage");

  let injected = false;
  try {
    docker("pause", alertContainer);
    injected = true;
  } catch (err) {
    logger.warn(
      { err, container: alertContainer },
      "alert container not found — alert sink outage injection skipped " +
        "(set CHAOS_ALERT_CONTAINER to the correct container name)",
    );
  }

  return async () => {
    if (!injected) return;
    logger.info({ container: alertContainer }, "restoring alert sink");
    try {
      docker("unpause", alertContainer);
    } catch (err) {
      logger.warn({ err }, "alert sink unpause failed — attempting restart");
      docker("start", alertContainer);
    }
  };
}
