/**
 * IPFS Pinning Service — Provider abstraction
 *
 * Pinning is abstracted behind `PinProvider` so at least two independent
 * backends can be wired for redundancy. Production backends implement the
 * provider HTTP API over injected `fetch`; tests use `InMemoryPinProvider`.
 *
 * Issue #754
 */

export interface PinProvider {
  readonly id: string;
  pin(cid: string, content: Uint8Array): Promise<void>;
  /** Returns true when the provider still holds the CID. */
  isPinned(cid: string): Promise<boolean>;
  /** Best-effort re-pin of content the caller still holds. */
  repin(cid: string, content: Uint8Array): Promise<void>;
}

/** In-memory provider (tests, local dev). Optionally fails on demand. */
export class InMemoryPinProvider implements PinProvider {
  private store = new Map<string, Uint8Array>();
  constructor(
    readonly id: string,
    private opts: { failPin?: boolean; failIsPinned?: boolean } = {},
  ) {}

  async pin(cid: string, content: Uint8Array): Promise<void> {
    if (this.opts.failPin) throw new Error(`${this.id}: simulated pin failure`);
    this.store.set(cid, content);
  }

  async isPinned(cid: string): Promise<boolean> {
    if (this.opts.failIsPinned) return false;
    return this.store.has(cid);
  }

  async repin(cid: string, content: Uint8Array): Promise<void> {
    this.store.set(cid, content);
  }

  /** Test hook: simulate remote GC / provider-side loss. */
  drop(cid: string): void {
    this.store.delete(cid);
  }
}

/** Minimal HTTP pinning backend (Pinata / web3.storage style) with injectable fetch. */
export class HttpPinProvider implements PinProvider {
  constructor(
    readonly id: string,
    private endpoint: string,
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async pin(cid: string, content: Uint8Array): Promise<void> {
    const res = await this.fetchFn(`${this.endpoint}/pins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/octet-stream",
        "X-CID": cid,
      },
      body: content as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`${this.id}: pin failed with HTTP ${res.status}`);
  }

  async isPinned(cid: string): Promise<boolean> {
    const res = await this.fetchFn(`${this.endpoint}/pins/${cid}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`${this.id}: status check HTTP ${res.status}`);
    return true;
  }

  async repin(cid: string, content: Uint8Array): Promise<void> {
    await this.pin(cid, content);
  }
}
