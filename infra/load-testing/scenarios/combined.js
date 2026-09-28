/**
 * Scenario: Combined Realistic Traffic
 *
 * Runs all three traffic patterns simultaneously as separate k6 scenarios.
 * This is the pre-release gate scenario — if this passes, the infrastructure
 * is considered ready for the next deployment.
 *
 * Traffic shape (concurrent):
 *   - browsing:      ramp 0→200 VUs, hold 5m, ramp down
 *   - funding_spike: ramp 0→300 VUs, hold 3m, ramp down
 *   - subscriptions: constant 100 VUs for full duration
 *
 * Scaled down from individual scenarios to reflect realistic concurrent mix.
 */

import { sleep, check } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import {
  assertNotProduction,
  apiGet,
  apiPost,
  indexerQuery,
  pick,
  RISK_TIERS,
  PAGE_SIZES,
  thinkTime,
  BASE_URL,
  API_KEY,
  STANDARD_THRESHOLDS,
} from "../lib/common.js";
import http from "k6/http";

// ── Custom metrics ────────────────────────────────────────────────────────────

const fundLatency     = new Trend("combined_fund_duration", true);
const fundSuccessRate = new Rate("combined_fund_success");

// ── Scenario config ───────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    browsing: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m",  target: 200 },
        { duration: "5m",  target: 200 },
        { duration: "30s", target: 0   },
      ],
      exec: "browsingUser",
    },
    funding: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m",  target: 300 },
        { duration: "3m",  target: 300 },
        { duration: "30s", target: 0   },
      ],
      exec: "fundingUser",
      startTime: "30s", // stagger start so browsing ramps first
    },
    subscriptions: {
      executor: "constant-vus",
      vus: 100,
      duration: "7m",
      exec: "subscribedUser",
    },
  },
  thresholds: {
    ...STANDARD_THRESHOLDS,
    combined_fund_duration:  ["p(95)<2500"],
    combined_fund_success:   ["rate>0.95"],
    http_req_failed:         ["rate<0.02"],
  },
};

export function setup() {
  assertNotProduction();
}

// ── Browsing user ─────────────────────────────────────────────────────────────

export function browsingUser() {
  const tier = pick(RISK_TIERS);
  const res = apiGet(`/api/v1/listings?status=active&risk_tier=${tier}&limit=${pick(PAGE_SIZES)}`);
  check(res, { "browse: 200": (r) => r.status === 200 });

  thinkTime(800, 2500);

  const invoiceId = Math.floor(Math.random() * 500) + 1;
  const detail = indexerQuery(`
    query($id:Int!){invoice(id:$id){id status amount currency dueDate riskTier}}
  `, { id: invoiceId });
  check(detail, { "detail: 200": (r) => r.status === 200 });

  thinkTime(500, 1500);
}

// ── Funding user ──────────────────────────────────────────────────────────────

export function fundingUser() {
  const invoiceId = Math.floor(Math.random() * 10) + 1; // concentrate on hot invoices
  const amount = 1_000_000 + Math.floor(Math.random() * 4_000_000);

  const start = Date.now();
  const res = apiPost(`/api/v1/listings/${invoiceId}/fund`, {
    investorId: `load-${__VU}-${__ITER}`,
    amount,
    tokenAddress: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  });

  fundLatency.add(Date.now() - start);
  const ok = res.status >= 200 && res.status < 300;
  fundSuccessRate.add(ok);
  check(res, { "fund: accepted": () => ok, "fund: no 5xx": (r) => r.status < 500 });

  thinkTime(1000, 3000);
}

// ── Subscribed user ───────────────────────────────────────────────────────────

export function subscribedUser() {
  const headers = { "Accept": "text/event-stream" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = http.get(`${BASE_URL}/api/v1/flags/stream`, {
    headers,
    tags: { type: "sse" },
    timeout: "35s",
  });
  check(res, {
    "SSE: connected": (r) => r.status === 200,
  });

  // Also simulate REST calls the subscribed page makes
  apiGet("/api/v1/flags");
  thinkTime(8000, 20000);
}
