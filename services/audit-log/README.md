# Audit Log Service

**Issue #768 — Audit Log Aggregation and Tamper-Evidence Service**

An off-chain, append-only, cryptographically hash-chained audit log for all privileged actions performed by Kora's off-chain services (keeper, FX relay, KYB, debtor verification, admin relay). Provides a standalone chain-integrity verifier tool.

---

## Architecture

```
Service (keeper / fx-ingestion / kyb / ...)
        │
        ▼
  AuditClient.emit(service, action, actorRef, metadata)
        │  SHA-256 hash of actorRef (never stored raw)
        ▼
  AuditStore.append()
        │  Serialised write (Promise mutex)
        │  prevHash = SHA-256(previous record)
        │  recordHash = SHA-256(sequence || timestamp || service || action || actorHash || metadata || prevHash)
        ▼
  SQLite (WAL mode, append-only table)
        │
        ▼
  verifyChain(records) ── CLI: ts-node src/verify.ts --db audit.db
```

### Hash chain structure

Each record contains:
- `prevHash` — SHA-256 of the previous record's canonical bytes (genesis = `000...0`)
- `recordHash` — SHA-256 of this record's own canonical bytes (excluding `recordHash`)

The verifier walks the chain from genesis and checks both fields on every record. The **first** broken link is reported.

### PII policy

`actorRef` is always SHA-256 hashed before storage. The `metadata` field must never contain raw PII — use `AuditClient.hashPii(value)` to hash any PII before including it in metadata.

### Concurrent writers

Writes are serialised within a process via a Promise queue (write lock). For multi-process deployments use a dedicated audit-log sidecar with SQLite WAL mode.

---

## Verifier tool

```bash
# Check chain integrity end-to-end
npm run verify -- --db ./audit.db

# Exit codes:
#   0  chain intact
#   1  tampering detected (first broken sequence reported)
#   2  empty log
```

---

## Integration (other services)

```typescript
import { AuditStore, AuditClient } from "@kora/audit-log";

const store = new AuditStore("./audit.db");
const client = new AuditClient(store);

await client.emit(
  "keeper",
  "keeper.job.dispatched",
  keeperAccountAddress,        // hashed automatically
  { invoiceId: "42", txHash: "0xabc" }  // no raw PII
);
```

---

## Configuration

| Env var | Default | Description |
|---|---|---|
| `AUDIT_DB_PATH` | `./audit.db` | SQLite file path |

---

## Testing

```bash
npm test
```

Minimum 90% coverage enforced. Tamper-detection and concurrent-writer tests included.
