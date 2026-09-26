/**
 * Indexer adapter — translates raw on-chain Soroban events into typed
 * KoraSubscriptionEvents and feeds them into the EventBus.
 *
 * This module is responsible for parsing the on-chain event schema defined
 * in docs/EVENTS.md and emitting strongly-typed events to local subscribers.
 *
 * Issue: #769
 */

import { EventBus } from "./event-bus";
import {
  FundingProgressEvent,
  PositionStatusChangeEvent,
  RepaymentEvent,
} from "./types";

/** Minimal on-chain event shape as returned by the Stellar RPC. */
export interface RawSorobanEvent {
  /** Three-element topics array: ["SCHEMA_V", "<TOPIC>", <version>] */
  topics: string[];
  /** JSON-decoded data tuple. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  /** Ledger sequence in which the event was published. */
  ledger: number;
}

const KNOWN_TOPICS = new Set([
  "INV_FUNDED",
  "POS_RECORDED",
  "PROTOCOL_REPAYMENT",
  "PROTOCOL_YIELD_DIST",
]);

export function ingestRawEvent(raw: RawSorobanEvent, bus: EventBus = EventBus.instance): void {
  if (raw.topics.length < 2) return;
  const topic = raw.topics[1];
  if (!KNOWN_TOPICS.has(topic)) return;

  switch (topic) {
    case "INV_FUNDED": {
      // Payload: (investor, invoice_id, funded_amount, timestamp)
      const [investor, invoiceId, fundedAmount, ts] = raw.data;
      // We need the pool state to compute totalFunded / faceValue.  For the
      // purposes of this service we approximate with the event data; the
      // full pool state should be enriched by the indexer before calling
      // ingestRawEvent — pass them as extra fields on `data` if available.
      const totalFunded: bigint = BigInt(raw.data[4] ?? fundedAmount);
      const faceValue: bigint = BigInt(raw.data[5] ?? fundedAmount);
      const progressBps = faceValue > 0n
        ? Number((totalFunded * 10_000n) / faceValue)
        : 0;
      const event: FundingProgressEvent = {
        topic: "listing-funding-progress",
        invoiceId: BigInt(invoiceId),
        totalFunded,
        faceValue,
        progressBps: Math.min(progressBps, 10_000),
        ledgerTimestamp: Number(ts),
      };
      bus.publish(event, raw.ledger);
      break;
    }

    case "POS_RECORDED": {
      // Payload: (admin, invoice_id, investor, contributed, share_bps, timestamp)
      const [, invoiceId, investor, contributed, shareBps, ts] = raw.data;
      const event: PositionStatusChangeEvent = {
        topic: "position-status-change",
        invoiceId: BigInt(invoiceId),
        investor: String(investor),
        contributed: BigInt(contributed),
        shareBps: Number(shareBps),
        yieldClaimed: 0n,
        ledgerTimestamp: Number(ts),
      };
      bus.publish(event, raw.ledger);
      break;
    }

    case "PROTOCOL_YIELD_DIST": {
      // Payload: (invoice_id, investor, yield_amount, timestamp)
      const [invoiceId, investor, yieldAmount, ts] = raw.data;
      const event: PositionStatusChangeEvent = {
        topic: "position-status-change",
        invoiceId: BigInt(invoiceId),
        investor: String(investor),
        contributed: 0n,   // not in this event; enriched separately if needed
        shareBps: 0,
        yieldClaimed: BigInt(yieldAmount),
        ledgerTimestamp: Number(ts),
      };
      bus.publish(event, raw.ledger);
      break;
    }

    case "PROTOCOL_REPAYMENT": {
      // Payload: (invoice_id, payer, amount, timestamp)
      const [invoiceId, payer, amount, ts] = raw.data;
      const event: RepaymentEvent = {
        topic: "repayment",
        invoiceId: BigInt(invoiceId),
        payer: String(payer),
        amount: BigInt(amount),
        ledgerTimestamp: Number(ts),
      };
      bus.publish(event, raw.ledger);
      break;
    }
  }
}
