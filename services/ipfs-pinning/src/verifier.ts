/**
 * IPFS Pinning Service — Periodic persistence verifier
 *
 * Reads every pin-status record, asks each provider `isPinned(cid)`, and on
 * failure re-pins from the service content cache (or alerts when content is
 * unavailable / failures exceed the threshold).
 *
 * Issue #754
 */

import { PinProvider } from "./providers";
import { PinStore } from "./store";
import { PinningService } from "./service";
import { PinStatusRecord, VerifierConfig } from "./types";

export class PinVerifier {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private providers: PinProvider[],
    private store: PinStore,
    private service: PinningService,
    private config: VerifierConfig = { intervalMs: 60_000, alertAfterFailures: 3 },
  ) {}

  /** Single verification pass over all records. Returns re-pinned CIDs. */
  async verifyOnce(): Promise<{ checked: number; repinned: string[]; failed: string[] }> {
    const records = this.store.listAll();
    const repinned: string[] = [];
    const failed: string[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const rec of records) {
      let missing: string[] = [];
      for (const p of this.providers) {
        try {
          if (!(await p.isPinned(rec.cid))) missing.push(p.id);
        } catch {
          missing.push(p.id);
        }
      }

      if (missing.length === 0) {
        this.store.upsert({
          ...rec,
          status: rec.consecutiveFailures > 0 ? "repinned" : rec.status === "failed" ? "failed" : "pinned",
          lastVerifiedAt: now,
          updatedAt: now,
          consecutiveFailures: 0,
        });
        continue;
      }

      // Re-pin missing providers from cache.
      const content = this.service.getCachedContent(rec.cid);
      let recovered = 0;
      if (content) {
        for (const id of missing) {
          const provider = this.providers.find((p) => p.id === id);
          if (!provider) continue;
          try {
            await provider.repin(rec.cid, content);
            recovered += 1;
          } catch {
            // stays missing
          }
        }
      }

      const stillMissing = missing.length - recovered;
      const failures = rec.consecutiveFailures + 1;
      const updated: PinStatusRecord = {
        ...rec,
        status: stillMissing === 0 ? "repinned" : "degraded",
        lastVerifiedAt: now,
        updatedAt: now,
        consecutiveFailures: stillMissing === 0 ? 0 : failures,
      };
      this.store.upsert(updated);
      if (stillMissing === 0) {
        repinned.push(rec.cid);
      } else {
        failed.push(rec.cid);
        if (failures >= this.config.alertAfterFailures) {
          this.config.onAlert?.(updated, `pin ${rec.cid} failing on ${stillMissing} provider(s)`);
        }
      }
    }

    return { checked: records.length, repinned, failed };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.verifyOnce().catch(() => undefined);
    }, this.config.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
