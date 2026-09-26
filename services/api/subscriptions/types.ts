/**
 * GraphQL Subscription Service — shared types
 *
 * Defines the event shapes and subscription filter contracts used by the
 * WebSocket / SSE fan-out layer.  Mirrors the on-chain event schema defined
 * in docs/EVENTS.md so that off-chain indexer events map 1-to-1 to GraphQL
 * subscription payloads.
 *
 * Issue: #769
 */

// ── Subscription Topics ───────────────────────────────────────────────────────

/** All topics a client can subscribe to. */
export type SubscriptionTopic =
  | "listing-funding-progress"
  | "position-status-change"
  | "repayment";

// ── Event Payloads ────────────────────────────────────────────────────────────

/** Emitted whenever an investor contributes to a listing (INV_FUNDED / POOL). */
export interface FundingProgressEvent {
  topic: "listing-funding-progress";
  invoiceId: bigint;
  /** Total amount funded so far, in stroops. */
  totalFunded: bigint;
  /** Face value of the invoice, in stroops. */
  faceValue: bigint;
  /** Fraction funded: 0–10_000 bps. */
  progressBps: number;
  ledgerTimestamp: number;
}

/** Emitted when an investor's position status changes (created / yield-claimed). */
export interface PositionStatusChangeEvent {
  topic: "position-status-change";
  invoiceId: bigint;
  /** The investor whose position changed — used for per-user scoping. */
  investor: string;
  contributed: bigint;
  shareBps: number;
  yieldClaimed: bigint;
  ledgerTimestamp: number;
}

/** Emitted when an SME repays an invoice (PROTOCOL_REPAYMENT). */
export interface RepaymentEvent {
  topic: "repayment";
  invoiceId: bigint;
  payer: string;
  amount: bigint;
  ledgerTimestamp: number;
}

export type KoraSubscriptionEvent =
  | FundingProgressEvent
  | PositionStatusChangeEvent
  | RepaymentEvent;

// ── Subscription Filters ──────────────────────────────────────────────────────

/** Options a subscriber may specify when connecting. */
export interface SubscriptionFilter {
  /** Limit events to a specific invoice ID. */
  invoiceId?: bigint;
  /**
   * For position-status-change: restrict to events affecting this address.
   * Enforced server-side; the subscriber must be authenticated as this address.
   */
  investorAddress?: string;
}

// ── Cursor / Resumable Subscriptions ─────────────────────────────────────────

/**
 * Opaque cursor returned with every event.  Clients send this back on
 * reconnect via the `after` parameter to replay missed events within the
 * reconnect grace window.
 */
export type EventCursor = string; // base64-encoded ledger sequence + event index

export interface EventEnvelope<T extends KoraSubscriptionEvent = KoraSubscriptionEvent> {
  cursor: EventCursor;
  event: T;
}
