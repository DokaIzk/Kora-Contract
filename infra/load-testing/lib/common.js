/**
 * Kora Load Testing — Shared Utilities
 *
 * Common helpers, thresholds, and data shared across all scenarios.
 */

import http from "k6/http";
import { check, sleep } from "k6";

// ── Environment ───────────────────────────────────────────────────────────────

export const BASE_URL = (__ENV.K6_BASE_URL || "").replace(/\/$/, "");
export const INDEXER_URL = (__ENV.K6_INDEXER_URL || BASE_URL).replace(/\/$/, "");
export const API_KEY = __ENV.K6_API_KEY || "";

/**
 * Guard: prevent accidental runs against production.
 * Called in the default setup() of every scenario.
 */
export function assertNotProduction() {
  if (!BASE_URL) {
    throw new Error("K6_BASE_URL is required");
  }
  if (!BASE_URL.includes("staging") && !BASE_URL.includes("localhost") && !BASE_URL.includes("127.0.0.1")) {
    throw new Error(
      `SAFETY: K6_BASE_URL does not appear to be a staging environment: ${BASE_URL}\n` +
      `Load tests must NOT run against production. Set K6_BASE_URL to a staging URL.`
    );
  }
}

// ── Common Thresholds ─────────────────────────────────────────────────────────

/**
 * Standard thresholds applied to all scenarios.
 * Override or extend in individual scenario files.
 */
export const STANDARD_THRESHOLDS = {
  // 95th percentile response time
  "http_req_duration{type:read}": ["p(95)<500"],
  // 99th percentile — allow higher latency tail
  "http_req_duration{type:read}": ["p(99)<1500"],
  // Write operations allowed slightly more headroom
  "http_req_duration{type:write}": ["p(95)<1000"],
  "http_req_duration{type:write}": ["p(99)<3000"],
  // Error rate must stay under 1%
  http_req_failed: ["rate<0.01"],
};

// ── Request Helpers ───────────────────────────────────────────────────────────

/**
 * Authenticated GET helper.
 */
export function apiGet(path, params = {}) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  return http.get(`${BASE_URL}${path}`, { headers, tags: { type: "read" }, ...params });
}

/**
 * Authenticated POST helper.
 */
export function apiPost(path, body, params = {}) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers, tags: { type: "write" }, ...params });
}

/**
 * Indexer GraphQL query helper.
 */
export function indexerQuery(query, variables = {}) {
  return http.post(
    `${INDEXER_URL}/graphql`,
    JSON.stringify({ query, variables }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { type: "read", component: "indexer" },
    }
  );
}

// ── Realistic Data ────────────────────────────────────────────────────────────

/** Randomly pick one item from an array. */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Risk tiers used for browsing filters. */
export const RISK_TIERS = ["AAA", "AA", "A", "B", "C"];

/** Currencies supported by the protocol. */
export const CURRENCIES = ["USDC", "EURC"];

/** Realistic page sizes for pagination. */
export const PAGE_SIZES = [10, 20, 50];

/** Realistic think-time between actions (seconds). */
export function thinkTime(minMs = 500, maxMs = 2000) {
  sleep((minMs + Math.random() * (maxMs - minMs)) / 1000);
}

// ── Check Wrappers ────────────────────────────────────────────────────────────

export function checkOk(res, label) {
  check(res, {
    [`${label}: status 200`]: (r) => r.status === 200,
    [`${label}: response time < 500ms`]: (r) => r.timings.duration < 500,
  });
}

export function checkCreated(res, label) {
  check(res, {
    [`${label}: status 201`]: (r) => r.status === 201,
    [`${label}: response time < 1000ms`]: (r) => r.timings.duration < 1000,
  });
}
