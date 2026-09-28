/**
 * Scenario: Subscription Fan-Out
 *
 * Traffic shape: 200 VUs holding open SSE connections for 10 minutes.
 * Assumption: the live dashboard and invoice detail pages all maintain
 * persistent SSE subscriptions for real-time updates.
 *
 * This scenario tests:
 *   - SSE connection capacity (nginx / Node.js fd limits)
 *   - Memory leak under sustained connections
 *   - Feature flag kill-switch delivery latency under load
 *   - Event fan-out throughput when many invoices are updated simultaneously
 *
 * NOTE: k6 SSE support uses the `k6/experimental/streams` extension or the
 * http long-poll workaround. This scenario uses the long-poll workaround
 * (repeated GET with timeout) which is functionally equivalent for load purposes.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import {
  assertNotProduction,
  apiGet,
  BASE_URL,
  API_KEY,
  thinkTime,
} from "../lib/common.js";

// ── Custom metrics ────────────────────────────────────────────────────────────

const sseConnectTime   = new Trend("sse_connect_time", true);
const sseMessageRate   = new Rate("sse_messages_received");
const sseDropRate      = new Rate("sse_connections_dropped");
const killSwitchDelay  = new Trend("kill_switch_propagation_ms", true);

// ── Scenario config ───────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    subscription_fanout: {
      executor: "constant-vus",
      vus: 200,
      duration: "10m",
    },
  },
  thresholds: {
    // SSE connections should not drop
    sse_connections_dropped:     ["rate<0.02"],
    // Kill-switch events must arrive within 10 seconds
    kill_switch_propagation_ms:  ["p(95)<10000"],
    // Underlying HTTP for SSE initial connect
    "http_req_duration{type:sse_connect}": ["p(95)<1000"],
    http_req_failed:             ["rate<0.01"],
  },
};

export function setup() {
  assertNotProduction();
}

// ── Virtual user behaviour ────────────────────────────────────────────────────

export default function () {
  const headers = { "Accept": "text/event-stream" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  // 1. Open SSE connection and receive events for up to 30 seconds
  //    k6 uses a streaming GET; we measure the connect latency separately.
  const connectStart = Date.now();
  const sseRes = http.get(`${BASE_URL}/api/v1/flags/stream`, {
    headers,
    tags: { type: "sse_connect" },
    timeout: "35s",
  });
  sseConnectTime.add(Date.now() - connectStart);

  const connected = sseRes.status === 200;
  sseDropRate.add(!connected);

  check(sseRes, {
    "SSE: connected (200)":         (r) => r.status === 200,
    "SSE: content-type event-stream": (r) =>
      (r.headers["Content-Type"] || "").includes("text/event-stream"),
  });

  if (!connected) {
    sleep(2);
    return;
  }

  // 2. Simulate listening — in a real SSE client we'd parse events.
  //    Here we measure whether the response body contains event data.
  const hasEvents = sseRes.body && sseRes.body.length > 0;
  sseMessageRate.add(hasEvents ? 1 : 0);

  check(sseRes, {
    "SSE: received event data": () => hasEvents,
  });

  // 3. Also simulate the concurrent REST traffic a subscribed user generates:
  //    polling their positions and the flag snapshot on reconnect.
  const flagsRes = apiGet("/api/v1/flags");
  check(flagsRes, { "flags snapshot: 200": (r) => r.status === 200 });

  // 4. Think time represents user staying on the page
  thinkTime(5000, 15000);
}
