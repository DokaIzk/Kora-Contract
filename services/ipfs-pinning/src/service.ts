/**
 * IPFS Pinning Service — Core upload pipeline
 *
 * 1. Validate format/size (allowlists + configured cap).
 * 2. Require `piiHandled` (PII must be hashed/encrypted before pinning).
 * 3. Hash-verify content integrity (SHA-256 vs claimed digest) BEFORE pinning.
 * 4. Pin redundantly across all configured providers (≥2 for redundancy).
 * 5. Persist a pin-status record for the periodic verification job.
 *
 * Partial failure: success requires ≥ `minSuccesses` (default 1). A single
 * provider failure degrades (recorded, returned with `degraded: true`) rather
 * than failing the upload; total failure throws.
 *
 * Issue #754
 */

import { createHash } from "crypto";
import { PinProvider } from "./providers";
import { PinStore } from "./store";
import { PinRequest, PinResult, PinningServiceConfig } from "./types";

export const DEFAULT_PINNING_CONFIG: PinningServiceConfig = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MiB
  allowedContentTypes: ["application/pdf", "application/json", "image/png", "image/jpeg"],
  allowedExtensions: [".pdf", ".json", ".png", ".jpg", ".jpeg"],
  minSuccesses: 1,
};

export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

export class PinningService {
  private contentCache = new Map<string, Uint8Array>();

  constructor(
    private providers: PinProvider[],
    private store: PinStore,
    private config: PinningServiceConfig = DEFAULT_PINNING_CONFIG,
  ) {
    if (providers.length < 2) {
      throw new Error("At least two independent pinning providers are required for redundancy");
    }
  }

  /** Content cache accessor for the verification job's re-pin path. */
  getCachedContent(cid: string): Uint8Array | undefined {
    return this.contentCache.get(cid);
  }

  async upload(req: PinRequest): Promise<PinResult> {
    if (!req.piiHandled) {
      throw new Error("PII_NOT_HANDLED: debtor PII must be hashed/encrypted before pinning");
    }
    if (!this.config.allowedContentTypes.includes(req.contentType)) {
      throw new Error(`UNSUPPORTED_TYPE: ${req.contentType}`);
    }
    if (!this.config.allowedExtensions.includes(extOf(req.filename))) {
      throw new Error(`UNSUPPORTED_EXTENSION: ${req.filename}`);
    }
    if (req.content.byteLength > this.config.maxFileSizeBytes) {
      throw new Error(
        `FILE_TOO_LARGE: ${req.content.byteLength} > ${this.config.maxFileSizeBytes}`,
      );
    }
    if (req.content.byteLength === 0) throw new Error("EMPTY_FILE");

    // Hash-verify BEFORE any network pin.
    const actual = sha256Hex(req.content);
    if (actual.toLowerCase() !== req.claimedSha256Hex.toLowerCase()) {
      throw new Error("INTEGRITY_MISMATCH: claimed sha256 does not match content");
    }

    // Content-derived CID (hex digest; gateway maps to CIDv0/v1 on read).
    const cid = actual;
    const now = Math.floor(Date.now() / 1000);

    const outcomes: Array<{ providerId: string; ok: boolean; error?: string }> = [];
    for (const p of this.providers) {
      try {
        await p.pin(cid, req.content);
        outcomes.push({ providerId: p.id, ok: true });
      } catch (err) {
        outcomes.push({
          providerId: p.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const successes = outcomes.filter((o) => o.ok).length;
    const minSuccesses = this.config.minSuccesses ?? 1;
    if (successes < minSuccesses) {
      this.store.upsert({
        cid,
        filename: req.filename,
        sizeBytes: req.content.byteLength,
        sha256Hex: actual,
        status: "failed",
        providers: JSON.stringify(outcomes),
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: null,
        consecutiveFailures: 1,
      });
      throw new Error(`PIN_FAILED: only ${successes}/${this.providers.length} providers succeeded`);
    }

    const degraded = successes < this.providers.length;
    this.contentCache.set(cid, req.content);
    this.store.upsert({
      cid,
      filename: req.filename,
      sizeBytes: req.content.byteLength,
      sha256Hex: actual,
      status: degraded ? "degraded" : "pinned",
      providers: JSON.stringify(outcomes),
      createdAt: now,
      updatedAt: now,
      lastVerifiedAt: null,
      consecutiveFailures: 0,
    });

    return {
      cid,
      sizeBytes: req.content.byteLength,
      sha256Hex: actual,
      providers: outcomes,
      degraded,
      pinnedAt: now,
    };
  }
}
