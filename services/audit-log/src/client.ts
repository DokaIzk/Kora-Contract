/**
 * Audit Log Service — Public Client
 *
 * Provides a clean API for other services (keeper, fx-ingestion, kyb, etc.)
 * to emit audit records without directly depending on the store internals.
 *
 * Ensures actorHash is a valid hex string before appending (prevents accidental
 * raw PII leakage).
 *
 * Issue #768
 */

import * as crypto from "crypto";
import { AuditStore } from "./store";
import { AuditService, AuditAction, AuditRecord } from "./types";
import pino from "pino";

const logger = pino({ name: "audit-log:client" });

export class AuditClient {
  constructor(private readonly store: AuditStore) {}

  /**
   * Emit an audit record.
   *
   * @param service    — originating service name
   * @param action     — canonical action type
   * @param actorRef   — raw actor identity; will be SHA-256 hashed before storage
   * @param metadata   — structured context; must NOT contain raw PII
   */
  async emit(
    service: AuditService,
    action: AuditAction,
    actorRef: string,
    metadata: Record<string, unknown>
  ): Promise<AuditRecord> {
    // Hash the actor reference to avoid storing raw PII
    const actorHash = crypto
      .createHash("sha256")
      .update(actorRef, "utf8")
      .digest("hex");

    logger.debug({ service, action }, "Emitting audit record");
    return this.store.append(service, action, actorHash, metadata);
  }

  /**
   * Convenience: hash a PII string to a hex reference for use in metadata.
   * Use this for any PII that must appear in metadata fields.
   */
  static hashPii(value: string): string {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
  }
}
