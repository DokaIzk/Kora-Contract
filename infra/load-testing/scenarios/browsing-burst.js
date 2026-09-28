/**
 * Scenario: Marketplace Browsing Burst
 *
 * Traffic shape: 0 → 300 VUs in 30s, hold for 2 minutes, ramp down to 0 over 30s.
 * Assumption: a popular new invoice listing drives a sudden wave of browsing traffic.
 *
 * Simulated actions (realistic user journey):
 *   1. Load marketplace listing page (paginated, filtered by risk tier)
 *   2. View invoice detail
 *   3. Check SME profile
 *   4. Query financing pool state for the invoice
 *   5. (Optional) fetch price oracle rate
 */

import { sleep, check } from "k6";
import { Trend, Counter } from "k6/metrics";
import {
  assertNotProduction,
  apiGet,
  indexerQuery,
  pick,
  RISK_TIERS,
  PAGE_SIZES,
  thinkTime,
  STANDARD_THRESHOLDS,
} from "../lib/common.js";

// ── Custom metrics ────────────────────────────────────────────────────────────

const listingLoadTime = new Trend("listing_load_time", true);
const detailLoadTime  = new Trend("invoice_detail_load_time", true);
const browseSessions  = new Counter("browse_sessions_total");

// ── Scenario config ───────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    browsing_burst: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 300 },  // ramp up
        { duration: "2m",  target: 300 },  // hold
        { duration: "30s", target: 0   },  // ramp down
      ],
    },
  },
  thresholds: {
    ...STANDARD_THRESHOLDS,
    listing_load_time: ["p(95)<400"],
    invoice_detail_load_time: ["p(95)<300"],
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  assertNotProduction();
}

// ── Virtual user behaviour ────────────────────────────────────────────────────

export default function () {
  browseSessions.add(1);

  // 1. Browse marketplace listings (paginated)
  const tier   = pick(RISK_TIERS);
  const limit  = pick(PAGE_SIZES);
  const listRes = apiGet(`/api/v1/listings?status=active&risk_tier=${tier}&limit=${limit}&page=1`);

  check(listRes, {
    "listings: 200 OK":           (r) => r.status === 200,
    "listings: has items":        (r) => {
      try { return Array.isArray(JSON.parse(r.body).data); } catch { return false; }
    },
    "listings: p95 < 400ms":      (r) => r.timings.duration < 400,
  });
  listingLoadTime.add(listRes.timings.duration);

  thinkTime(800, 2500);

  // 2. Open an invoice detail (GraphQL query to indexer — richer data)
  const invoiceId = Math.floor(Math.random() * 500) + 1;
  const detailRes = indexerQuery(`
    query InvoiceDetail($id: Int!) {
      invoice(id: $id) {
        id status amount currency dueDate riskTier
        sme { address riskScore }
        pool { totalFunded totalRepaid positions { count } }
      }
    }
  `, { id: invoiceId });

  check(detailRes, {
    "invoice detail: 200 OK":     (r) => r.status === 200,
    "invoice detail: no errors":  (r) => {
      try { return !JSON.parse(r.body).errors; } catch { return false; }
    },
    "invoice detail: p95 < 300ms": (r) => r.timings.duration < 300,
  });
  detailLoadTime.add(detailRes.timings.duration);

  thinkTime(500, 1500);

  // 3. Fetch SME profile (REST)
  const profileRes = apiGet(`/api/v1/sme/profile/sample-address-${invoiceId % 50}`);
  check(profileRes, { "sme profile: 200 or 404": (r) => r.status === 200 || r.status === 404 });

  thinkTime(300, 800);

  // 4. Check price oracle rate (lightweight read)
  const oracleRes = apiGet(`/api/v1/oracle/rate?base=USDC&quote=XLM`);
  check(oracleRes, { "oracle: 200 OK": (r) => r.status === 200 });
}
