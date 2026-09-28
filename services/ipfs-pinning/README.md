# Invoice Metadata Pinning Service

**Issue #754 — Build Invoice Metadata Pinning Service for IPFS**

Accepts SME-submitted invoice documents/metadata, pins them redundantly to
IPFS, and returns the CID recorded on-chain in `invoice_nft`. Verifies pin
persistence periodically and re-pins/alerts on failure.

Out of scope: on-chain CID recording itself (the SME's own transaction handles
that).

## Architecture

```
upload(PinRequest)
  ├─ validate format/size (allowlist + maxFileSizeBytes)
  ├─ require piiHandled (PII hashed/encrypted before pinning)
  ├─ hash-verify SHA-256 BEFORE pinning (reject INTEGRITY_MISMATCH)
  ├─ pin via PinProvider[] (≥2 backends: e.g. Pinata + web3.storage)
  └─ persist PinStatusRecord (SQLite) ──► PinVerifier.verifyOnce() (periodic)
                                            ├─ isPinned per provider
                                            ├─ repin from cache on failure
                                            └─ onAlert after N failures
```

## Usage

```ts
import { PinningService, PinStore, InMemoryPinProvider } from "@kora/ipfs-pinning";

const store = new PinStore("./pins.db");
const svc = new PinningService(
  [new HttpPinProvider("pinata", process.env.PINATA_URL!, process.env.PINATA_TOKEN!),
   new HttpPinProvider("web3storage", process.env.W3S_URL!, process.env.W3S_TOKEN!)],
  store,
);
const res = await svc.upload({
  filename: "invoice-42.json",
  content: bytes,
  contentType: "application/json",
  claimedSha256Hex: "<client-computed sha256>",
  piiHandled: true,
});
// res.cid → record on-chain via invoice_nft.mint_invoice
```

## Configuration

| Option | Default | Description |
|---|---|---|
| `maxFileSizeBytes` | `10 MiB` | Files above are rejected pre-pin |
| `allowedContentTypes` | pdf/json/png/jpeg | MIME allowlist |
| `allowedExtensions` | `.pdf .json .png .jpg .jpeg` | Extension allowlist |
| `minSuccesses` | `1` | Minimum provider pins; total failure throws |

## Testing

```bash
npm install
npm test   # 90% line/branch/function/statement coverage enforced
```

Covers dual-provider success, partial-failure degradation, integrity-mismatch
rejection, and periodic re-pin-on-failure + alerting.
