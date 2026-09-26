/**
 * EventBus — in-process fan-out for Kora subscription events.
 *
 * Each call to `publish()` dispatches the event synchronously to every
 * registered subscriber whose filter matches.  This is intentionally a
 * single-process primitive; in a multi-replica deployment this should be
 * replaced (or backed) by a Redis Pub/Sub channel or NATS subject.
 *
 * Issue: #769
 */

import { EventEmitter } from "events";
import {
  EventCursor,
  EventEnvelope,
  KoraSubscriptionEvent,
  SubscriptionFilter,
  SubscriptionTopic,
} from "./types";

// ── Cursor helpers ────────────────────────────────────────────────────────────

let _sequence = 0;

function makeCursor(ledger: number, index: number): EventCursor {
  return Buffer.from(JSON.stringify({ ledger, index })).toString("base64");
}

function parseCursor(cursor: EventCursor): { ledger: number; index: number } | null {
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// ── Ring buffer for reconnect replay ─────────────────────────────────────────

const RING_BUFFER_SIZE = 1_000;
const _ring: Array<EventEnvelope> = [];

function ringPush(env: EventEnvelope): void {
  if (_ring.length >= RING_BUFFER_SIZE) _ring.shift();
  _ring.push(env);
}

/** Return buffered events published after `cursor` (exclusive). */
function replayAfter(cursor: EventCursor): EventEnvelope[] {
  const parsed = parseCursor(cursor);
  if (!parsed) return [];
  return _ring.filter((e) => {
    const c = parseCursor(e.cursor);
    return c !== null && (c.ledger > parsed.ledger || (c.ledger === parsed.ledger && c.index > parsed.index));
  });
}

// ── Subscriber registry ───────────────────────────────────────────────────────

interface Subscriber {
  id: string;
  topic: SubscriptionTopic;
  filter: SubscriptionFilter;
  /** Authenticated investor address; required for position-status-change. */
  authenticatedAs?: string;
  callback: (env: EventEnvelope) => void;
}

const _subscribers = new Map<string, Subscriber>();
let _subCounter = 0;

// ── EventBus ──────────────────────────────────────────────────────────────────

export class EventBus extends EventEmitter {
  private static _instance: EventBus;

  private constructor() {
    super();
    this.setMaxListeners(0);
  }

  static get instance(): EventBus {
    if (!EventBus._instance) EventBus._instance = new EventBus();
    return EventBus._instance;
  }

  /**
   * Publish a Kora event from the indexer.  Returns the cursor assigned to
   * this event (can be forwarded to subscribers).
   */
  publish(event: KoraSubscriptionEvent, ledger: number): EventCursor {
    const cursor = makeCursor(ledger, _sequence++);
    const envelope: EventEnvelope = { cursor, event };
    ringPush(envelope);
    this.emit("event", envelope);
    return cursor;
  }

  /**
   * Subscribe to a specific topic with an optional filter.
   *
   * @param topic        The event topic.
   * @param filter       Optional filter (invoiceId, investorAddress).
   * @param authenticatedAs  The address the caller has authenticated as.
   *                         Required when subscribing to position-status-change.
   * @param callback     Called for every matching event.
   * @returns            Subscription ID (pass to `unsubscribe`).
   */
  subscribe(
    topic: SubscriptionTopic,
    filter: SubscriptionFilter,
    authenticatedAs: string | undefined,
    callback: (env: EventEnvelope) => void,
    afterCursor?: EventCursor
  ): string {
    // Enforce per-user scoping: position-status-change MUST be scoped to the
    // authenticated investor — a user cannot subscribe to someone else's positions.
    if (topic === "position-status-change") {
      if (!authenticatedAs) {
        throw new Error("Authentication required for position-status-change subscriptions");
      }
      if (filter.investorAddress && filter.investorAddress !== authenticatedAs) {
        throw new Error("Cannot subscribe to another investor's position updates");
      }
      // Implicitly scope to the authenticated address.
      filter = { ...filter, investorAddress: authenticatedAs };
    }

    const id = `sub_${++_subCounter}`;
    _subscribers.set(id, { id, topic, filter, authenticatedAs, callback });

    this.on("event", (env: EventEnvelope) => {
      if (!_subscribers.has(id)) return; // already unsubscribed
      const sub = _subscribers.get(id)!;
      if (this._matches(env.event, sub)) sub.callback(env);
    });

    // Replay missed events if the client provided a cursor (reconnect).
    if (afterCursor) {
      const missed = replayAfter(afterCursor).filter((env) => this._matches(env.event, _subscribers.get(id)!));
      missed.forEach((env) => callback(env));
    }

    return id;
  }

  unsubscribe(subscriptionId: string): void {
    _subscribers.delete(subscriptionId);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _matches(event: KoraSubscriptionEvent, sub: Subscriber): boolean {
    if (event.topic !== sub.topic) return false;

    const { filter } = sub;

    if (filter.invoiceId !== undefined && "invoiceId" in event) {
      if (event.invoiceId !== filter.invoiceId) return false;
    }

    if (sub.topic === "position-status-change" && filter.investorAddress) {
      const e = event as { investor?: string };
      if (e.investor !== filter.investorAddress) return false;
    }

    return true;
  }
}
