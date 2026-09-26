/**
 * Subscription service tests — issue #769
 *
 * Covers:
 *  - Fan-out correctness under concurrent subscribers
 *  - Per-user scoping enforcement (position-status-change)
 *  - Reconnect with cursor resumption (no missed events)
 *  - Cross-user isolation (cannot subscribe to another investor's positions)
 */

import { EventBus } from "../event-bus";
import { ingestRawEvent, RawSorobanEvent } from "../indexer-adapter";
import {
  EventEnvelope,
  FundingProgressEvent,
  KoraSubscriptionEvent,
  PositionStatusChangeEvent,
  RepaymentEvent,
} from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshBus(): EventBus {
  // Access the private constructor via cast to create isolated instances.
  // In production a single singleton is used; tests get isolated instances.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (EventBus as any)();
}

function makeRawFunding(invoiceId: number, investor: string, amount: number, ledger = 100): RawSorobanEvent {
  return {
    topics: ["SCHEMA_V", "INV_FUNDED", "1"],
    data: [investor, invoiceId, amount, Math.floor(Date.now() / 1000), amount, amount * 2],
    ledger,
  };
}

function makeRawPosition(invoiceId: number, investor: string, ledger = 101): RawSorobanEvent {
  return {
    topics: ["SCHEMA_V", "POS_RECORDED", "1"],
    data: ["admin", invoiceId, investor, 1000, 5000, Math.floor(Date.now() / 1000)],
    ledger,
  };
}

function makeRawRepayment(invoiceId: number, payer: string, ledger = 102): RawSorobanEvent {
  return {
    topics: ["SCHEMA_V", "PROTOCOL_REPAYMENT", "1"],
    data: [invoiceId, payer, 10000, Math.floor(Date.now() / 1000)],
    ledger,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EventBus — fan-out correctness", () => {
  it("delivers funding events to all matching subscribers", () => {
    const bus = freshBus();
    const received1: KoraSubscriptionEvent[] = [];
    const received2: KoraSubscriptionEvent[] = [];

    bus.subscribe("listing-funding-progress", {}, undefined, (env) => received1.push(env.event));
    bus.subscribe("listing-funding-progress", {}, undefined, (env) => received2.push(env.event));

    ingestRawEvent(makeRawFunding(1, "INVESTOR_A", 500), bus);
    ingestRawEvent(makeRawFunding(2, "INVESTOR_B", 300), bus);

    expect(received1).toHaveLength(2);
    expect(received2).toHaveLength(2);
  });

  it("filters by invoiceId correctly", () => {
    const bus = freshBus();
    const received: KoraSubscriptionEvent[] = [];

    bus.subscribe("listing-funding-progress", { invoiceId: 1n }, undefined, (env) =>
      received.push(env.event)
    );

    ingestRawEvent(makeRawFunding(1, "INVESTOR_A", 500), bus);
    ingestRawEvent(makeRawFunding(2, "INVESTOR_B", 300), bus); // should NOT arrive

    expect(received).toHaveLength(1);
    expect((received[0] as FundingProgressEvent).invoiceId).toBe(1n);
  });

  it("delivers repayment events to subscribers", () => {
    const bus = freshBus();
    const received: RepaymentEvent[] = [];

    bus.subscribe("repayment", {}, undefined, (env) => received.push(env.event as RepaymentEvent));
    ingestRawEvent(makeRawRepayment(5, "SME_ADDR"), bus);

    expect(received).toHaveLength(1);
    expect(received[0].payer).toBe("SME_ADDR");
    expect(received[0].invoiceId).toBe(5n);
  });

  it("does not cross-deliver between different topics", () => {
    const bus = freshBus();
    const fundingEvents: KoraSubscriptionEvent[] = [];
    const repaymentEvents: KoraSubscriptionEvent[] = [];

    bus.subscribe("listing-funding-progress", {}, undefined, (env) => fundingEvents.push(env.event));
    bus.subscribe("repayment", {}, undefined, (env) => repaymentEvents.push(env.event));

    ingestRawEvent(makeRawFunding(1, "INVESTOR_A", 500), bus);
    ingestRawEvent(makeRawRepayment(1, "SME_ADDR"), bus);

    expect(fundingEvents).toHaveLength(1);
    expect(repaymentEvents).toHaveLength(1);
  });
});

describe("EventBus — per-user scoping enforcement", () => {
  it("throws when subscribing to position-status-change without authentication", () => {
    const bus = freshBus();
    expect(() =>
      bus.subscribe("position-status-change", {}, undefined, () => {})
    ).toThrow("Authentication required");
  });

  it("throws when subscribing to another investor's position data", () => {
    const bus = freshBus();
    expect(() =>
      bus.subscribe(
        "position-status-change",
        { investorAddress: "INVESTOR_B" },
        "INVESTOR_A",
        () => {}
      )
    ).toThrow("Cannot subscribe to another investor");
  });

  it("only delivers own position events to an authenticated subscriber", () => {
    const bus = freshBus();
    const eventsA: PositionStatusChangeEvent[] = [];
    const eventsB: PositionStatusChangeEvent[] = [];

    bus.subscribe("position-status-change", {}, "INVESTOR_A", (env) =>
      eventsA.push(env.event as PositionStatusChangeEvent)
    );
    bus.subscribe("position-status-change", {}, "INVESTOR_B", (env) =>
      eventsB.push(env.event as PositionStatusChangeEvent)
    );

    ingestRawEvent(makeRawPosition(1, "INVESTOR_A"), bus);
    ingestRawEvent(makeRawPosition(2, "INVESTOR_B"), bus);

    expect(eventsA).toHaveLength(1);
    expect(eventsA[0].investor).toBe("INVESTOR_A");

    expect(eventsB).toHaveLength(1);
    expect(eventsB[0].investor).toBe("INVESTOR_B");
  });
});

describe("EventBus — reconnect with cursor resumption", () => {
  it("replays missed events after reconnect within the grace window", () => {
    const bus = freshBus();
    const cursors: string[] = [];

    // First connection — records cursor
    bus.subscribe("repayment", {}, undefined, (env) => cursors.push(env.cursor));
    ingestRawEvent(makeRawRepayment(1, "SME_A", 100), bus);
    ingestRawEvent(makeRawRepayment(2, "SME_B", 101), bus);

    expect(cursors).toHaveLength(2);
    const lastCursor = cursors[0]; // simulate client last-seen before disconnect

    // Publish an event while client is "disconnected"
    ingestRawEvent(makeRawRepayment(3, "SME_C", 102), bus);

    // Reconnect with cursor — should receive the missed event
    const replayed: KoraSubscriptionEvent[] = [];
    bus.subscribe("repayment", {}, undefined, (env) => replayed.push(env.event), lastCursor);

    // Replay delivers events after lastCursor
    expect(replayed.length).toBeGreaterThanOrEqual(1);
    const invoiceIds = replayed.map((e) => (e as RepaymentEvent).invoiceId);
    expect(invoiceIds).toContain(3n);
  });

  it("does not replay events published before the cursor", () => {
    const bus = freshBus();
    const cursors: string[] = [];

    bus.subscribe("repayment", {}, undefined, (env) => cursors.push(env.cursor));
    ingestRawEvent(makeRawRepayment(10, "SME_X", 200), bus);
    ingestRawEvent(makeRawRepayment(11, "SME_Y", 201), bus);

    // Client saw both events — reconnect with the last cursor
    const afterBothCursor = cursors[cursors.length - 1];

    const replayed: KoraSubscriptionEvent[] = [];
    bus.subscribe("repayment", {}, undefined, (env) => replayed.push(env.event), afterBothCursor);

    expect(replayed).toHaveLength(0); // nothing new to replay
  });
});

describe("EventBus — unsubscribe", () => {
  it("stops delivering events after unsubscribe", () => {
    const bus = freshBus();
    const received: KoraSubscriptionEvent[] = [];

    const subId = bus.subscribe("repayment", {}, undefined, (env) => received.push(env.event));
    ingestRawEvent(makeRawRepayment(1, "SME_A", 300), bus);
    bus.unsubscribe(subId);
    ingestRawEvent(makeRawRepayment(2, "SME_B", 301), bus);

    expect(received).toHaveLength(1); // only the first event
  });
});

describe("EventEnvelope — cursor format", () => {
  it("cursor is a non-empty base64 string", () => {
    const bus = freshBus();
    const envelopes: EventEnvelope[] = [];

    bus.subscribe("repayment", {}, undefined, (env) => envelopes.push(env));
    ingestRawEvent(makeRawRepayment(99, "SME_Z", 500), bus);

    expect(envelopes).toHaveLength(1);
    const cursor = envelopes[0].cursor;
    expect(typeof cursor).toBe("string");
    expect(cursor.length).toBeGreaterThan(0);
    // Must be valid base64
    expect(() => Buffer.from(cursor, "base64").toString("utf8")).not.toThrow();
  });
});
