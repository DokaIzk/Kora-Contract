/**
 * Scenario: Funding Round Spike
 *
 * Traffic shape: 0 → 500 VUs over 1 minute, sustained for 3 minutes, ramp down.
 * Assumption: a high-yield AAA invoice goes live and investors rush to fund it.
 *
 * Simulated actions:
 *   1. Authenticate (get session token)
 *   2. Fetch feature flags (secondary-market, fractionalization enabled check)
 *   3. Load invoice detail
 *   4. Submit funding contribution (write path — hits API gateway → contract RPC)
 *   5. Poll for position confirmation
 *
 * This scenario stress-tests the write path including contract invocation latency.
 */

import { sleep, check } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import {
  assertNotProduction,
  apiGet,
  apiPost,
  thinkTime,
  STANDARD_THRESHOLDS,
} from "../lib/common.js";

// ── Custom metrics ────────────────────────────────────────────────────────────

const fundLatency     = new Trend("fund_contribution_duration", true);
const fundSuccessRate = new Rate("fund_contribution_success");
const fundAttempts    = new Counter("fund_attempts_total");

// ── Scenario config ───────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    funding_spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m",  target: 500 }, // aggressive ramp — simulates rush
        { duration: "3m",  target: 500 }, // sustained peak
        { duration: "30s", target: 0   }, // ramp down
      ],
    },
  },
  thresholds: {
    ...STANDARD_THRESHOLDS,
    // Funding is a write operation; allow wider p95 due to contract RPC
    fund_contribution_duration: ["p(95)<2000", "p(99)<5000"],
    fund_contribution_success:  ["rate>0.95"],
    http_req_failed:            ["rate<0.02"], // slightly higher tolerance for write path
  },
};

export function setup() {
  assertNotProduction();
}

// ── Virtual user behaviour ────────────────────────────────────────────────────

export default function () {
  // Simulate a fixed hot invoice that many investors want to fund
  // In reality this would be parameterised from test data seeded in setup()
  const HOT_INVOICE_ID = 1;

  // 1. Fetch feature flags at session start
  const flagRes = apiGet("/api/v1/flags");
  check(flagRes, { "flags: 200 OK": (r) => r.status === 200 });

  thinkTime(200, 600);

  // 2. Fetch invoice detail before committing
  const detailRes = apiGet(`/api/v1/listings/${HOT_INVOICE_ID}`);
  check(detailRes, { "listing detail: 200 OK": (r) => r.status === 200 });

  thinkTime(500, 1500);

  // 3. Submit funding contribution
  // Each VU uses a distinct simulated investor address to avoid conflicts
  const investorId = `load-test-investor-${__VU}-${__ITER}`;
  const contribution = 1_000_000 + Math.floor(Math.random() * 9_000_000); // 1–10 USDC in stroops

  fundAttempts.add(1);
  const fundRes = apiPost(`/api/v1/listings/${HOT_INVOICE_ID}/fund`, {
    investorId,
    amount: contribution,
    tokenAddress: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", // staging USDC
  });

  const fundOk = fundRes.status === 200 || fundRes.status === 201 || fundRes.status === 202;
  fundSuccessRate.add(fundOk);
  fundLatency.add(fundRes.timings.duration);

  check(fundRes, {
    "fund: accepted":             (r) => fundOk,
    "fund: p95 < 2000ms":         (r) => r.timings.duration < 2000,
    "fund: no 5xx":               (r) => r.status < 500,
  });

  thinkTime(300, 800);

  // 4. Poll for position confirmation (eventual consistency on indexer)
  if (fundOk) {
    sleep(1); // brief wait for indexer to process
    const posRes = apiGet(`/api/v1/positions/${HOT_INVOICE_ID}/${investorId}`);
    check(posRes, { "position: confirmed or pending": (r) => r.status === 200 || r.status === 202 });
  }
}
