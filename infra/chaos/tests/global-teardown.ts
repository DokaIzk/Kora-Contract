/**
 * Jest global teardown — runs once after all scenarios.
 *
 * Verifies that staging services are healthy after the full suite.  If any
 * service is still down (a scenario cleanup must have failed), logs the
 * details clearly so an operator can manually recover the environment.
 */

import { apiIsHealthy, indexerIsHealthy, keeperIsHealthy, waitUntil } from "../src/probes";
import { config } from "../src/config";
import { logger } from "../src/logger";

export default async function globalTeardown(): Promise<void> {
  logger.info("Chaos suite finished — verifying staging recovery");

  const checks: Array<[string, () => Promise<boolean>]> = [
    ["API", apiIsHealthy],
    ["Indexer", indexerIsHealthy],
    ["Keeper", keeperIsHealthy],
  ];

  const degraded: string[] = [];

  for (const [name, probe] of checks) {
    const recovered = await waitUntil(probe, config.recoveryTimeoutMs);
    if (recovered) {
      logger.info({ service: name }, "teardown: healthy");
    } else {
      logger.error({ service: name }, "teardown: STILL UNHEALTHY after recovery timeout");
      degraded.push(name);
    }
  }

  if (degraded.length > 0) {
    logger.error(
      { degraded },
      "WARNING: staging environment may require manual recovery. " +
        "Run `docker compose -p kora-staging restart` to restore.",
    );
    // Do not throw — the test results already reflect the failures.
    // A throw here would mask the per-scenario results in CI logs.
  }
}
