import { sha256Hex, PinningService } from "../src/service";
import { InMemoryPinProvider } from "../src/providers";
import { PinStore } from "../src/store";
import { PinVerifier } from "../src/verifier";

function req(content: string, overrides: Record<string, unknown> = {}) {
  const bytes = new TextEncoder().encode(content);
  return {
    filename: "invoice.json",
    content: bytes,
    contentType: "application/json",
    claimedSha256Hex: sha256Hex(bytes),
    piiHandled: true,
    ...overrides,
  };
}

describe("ipfs-pinning (issue #754)", () => {
  test("dual-provider pin success returns a CID", async () => {
    const store = new PinStore();
    const svc = new PinningService(
      [new InMemoryPinProvider("a"), new InMemoryPinProvider("b")],
      store,
    );
    const res = await svc.upload(req('{"invoice":1}'));
    expect(res.cid).toHaveLength(64);
    expect(res.degraded).toBe(false);
    expect(res.providers.filter((p) => p.ok)).toHaveLength(2);
    expect(store.get(res.cid)?.status).toBe("pinned");
    store.close();
  });

  test("partial failure degrades instead of failing when minSuccesses=1", async () => {
    const store = new PinStore();
    const svc = new PinningService(
      [new InMemoryPinProvider("a"), new InMemoryPinProvider("b", { failPin: true })],
      store,
    );
    const res = await svc.upload(req('{"invoice":2}'));
    expect(res.degraded).toBe(true);
    expect(res.providers.filter((p) => p.ok)).toHaveLength(1);
    expect(store.get(res.cid)?.status).toBe("degraded");
    store.close();
  });

  test("total failure throws and records failed status", async () => {
    const store = new PinStore();
    const svc = new PinningService(
      [
        new InMemoryPinProvider("a", { failPin: true }),
        new InMemoryPinProvider("b", { failPin: true }),
      ],
      store,
    );
    await expect(svc.upload(req('{"invoice":3}'))).rejects.toThrow(/PIN_FAILED/);
    store.close();
  });

  test("integrity-hash mismatch is rejected before pinning", async () => {
    const store = new PinStore();
    const svc = new PinningService(
      [new InMemoryPinProvider("a"), new InMemoryPinProvider("b")],
      store,
    );
    await expect(
      svc.upload(req("hello", { claimedSha256Hex: "00".repeat(32) })),
    ).rejects.toThrow(/INTEGRITY_MISMATCH/);
    expect(store.listAll()).toHaveLength(0);
    store.close();
  });

  test("size cap, type allowlist, and PII gate are enforced", async () => {
    const store = new PinStore();
    const svc = new PinningService(
      [new InMemoryPinProvider("a"), new InMemoryPinProvider("b")],
      store,
      {
        maxFileSizeBytes: 4,
        allowedContentTypes: ["application/json"],
        allowedExtensions: [".json"],
      },
    );
    await expect(svc.upload(req("12345"))).rejects.toThrow(/FILE_TOO_LARGE/);
    await expect(
      svc.upload(req("a", { contentType: "video/mp4", filename: "x.mp4" })),
    ).rejects.toThrow(/UNSUPPORTED_TYPE/);
    await expect(svc.upload(req("a", { piiHandled: false }))).rejects.toThrow(/PII_NOT_HANDLED/);
    store.close();
  });

  test("periodic verifier re-pins on failure and alerts past threshold", async () => {
    const store = new PinStore();
    const a = new InMemoryPinProvider("a");
    const b = new InMemoryPinProvider("b");
    const svc = new PinningService([a, b], store);
    const alerts: string[] = [];
    const verifier = new PinVerifier([a, b], store, svc, {
      intervalMs: 1_000_000,
      alertAfterFailures: 1,
      onAlert: (_rec, msg) => alerts.push(msg),
    });
    const res = await svc.upload(req('{"invoice":9}'));
    // Simulate provider-side loss on b where cache still holds content → repin.
    b.drop(res.cid);
    const out = await verifier.verifyOnce();
    expect(out.repinned).toContain(res.cid);

    // Simulate loss with NO cached content (fresh service instance sharing the store).
    const svc2 = new PinningService([a, b], store);
    const verifier2 = new PinVerifier([a, b], store, svc2, {
      intervalMs: 1_000_000,
      alertAfterFailures: 1,
      onAlert: (_rec, msg) => alerts.push(msg),
    });
    b.drop(res.cid);
    const out2 = await verifier2.verifyOnce();
    expect(out2.failed).toContain(res.cid);
    expect(alerts.length).toBeGreaterThan(0);
    store.close();
  });
});
