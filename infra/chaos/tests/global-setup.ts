/**
 * Jest global setup — runs once before any scenario.
 *
 * Guards:
 *  1. Refuses to run against a production environment.
 *  2. Verifies that the required staging services are reachable before any
 *     failure is injected — a pre-flight failure is far easier to debug than
 *     a scenario that silently passes because the service was never up.
 */

import { config } from "../src/config";
import { apiIsHealthy, indexerIsHealthy, keeperIsHealthy } from "../src/probes";
import { logger } from "../src/logger";

export default async function globalSetup(): Promise<void> {
  // ── Safety guard ────────────────────────────────────────────────────────
  if (config.env === "production") {
    throw new Error(
      "CHAOS SUITE REFUSED: CHAOS_ENV is set to 'production'. " +
        "This suite must only run against a staging environment.",
    );
  }

  logger.info({ env: config.env }, "Kora chaos suite — global setup");
  logger.info({ apiBaseUrl: config.apiBaseUrl }, "target API");
  logger.info({ indexerAdminUrl: config.indexerAdminUrl }, "target indexer admin");
  logger.info({ keeperAdminUrl: config.keeperAdminUrl }, "target keeper admin");

  // ── Pre-flight health checks ────────────────────────────────────────────
  const checks: Array<[string, () => Promise<boolean>]> = [
    ["API", apiIsHealthy],
    ["Indexer", indexerIsHealthy],
    ["Keeper", keeperIsHealthy],
  ];

  const failed: string[] = [];
  for (const [name, probe] of checks) {
    const ok = await probe();
    if (ok) {
      logger.info({ service: name }, "pre-flight: healthy");
    } else {
      logger.error({ service: name }, "pre-flight: UNHEALTHY — service not reachable");
      failed.push(name);
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Chaos pre-flight failed: services not reachable: ${failed.join(", ")}. ` +
        "Ensure the staging stack is running before starting the chaos suite.",
    );
  }

  logger.info("All pre-flight checks passed — starting chaos scenarios");
}
