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

## Cross-Verification Tool

Independently verifies consistency between the off-chain hash-chained audit log and the on-chain event history (`ADM_AUDIT` topic from Soroban contracts). This tool provides the critical cross-check that validates the two independent audit trails agree on what admin actions occurred.

```bash
# Cross-verify on-chain events with off-chain audit log
npm run cross-verify -- \
  --db ./audit.db \
  --rpc https://soroban-testnet.stellar.org \
  --contracts CABC123...,CDEF456... \
  --start-timestamp 1633046400000 \
  --end-timestamp 1633132800000 \
  --skew-tolerance-ms 60000

# Exit codes:
#   0  trails consistent
#   1  divergence detected (detailed report on stderr)
#   2  configuration error
```

### Parameters:

| Flag | Required | Description |
|---|---|---|
| `--db` | Yes | Path to SQLite audit log database |
| `--rpc` | Yes | Soroban RPC URL for fetching on-chain events |
| `--contracts` | Yes | Comma-separated list of contract IDs to query |
| `--start-timestamp` | No | Unix timestamp (ms) for start of range (default: 0) |
| `--end-timestamp` | No | Unix timestamp (ms) for end of range (default: now) |
| `--skew-tolerance-ms` | No | Acceptable timing difference between trails (default: 60000ms) |

### What It Checks:

1. **Action presence**: Every on-chain admin action has a corresponding off-chain record (and vice versa, when expected)
2. **Actor correspondence**: The actor (address) matches across both trails (compared via SHA-256 hash)
3. **Timing consistency**: Timestamps are within tolerance (benign clock skew acceptable)
4. **Semantic equivalence**: On-chain action types map to expected off-chain action types

### Output:

The tool generates a detailed report showing:
- Total events/records in each trail
- Number matched, timing skew within tolerance, and missing from either side
- Detailed breakdown of each mismatch with specific reasons

### When to Run:

- **On-demand**: After any suspected tampering or data integrity issue
- **Scheduled**: Daily/weekly automated runs feeding into monitoring/alerting
- **Before audits**: Proactive verification before external security audits

### Action Correspondence:

The tool defines semantic mappings between on-chain `AdminActionType` and off-chain `AuditAction`:

- `Pause`, `Unpause`, `GrantRole`, `RevokeRole`, etc. → `admin.relay.transaction.confirmed`
- `RecordDefault` → `debtor.verification.completed`
- Direct contract calls (e.g., `CorrectMetadataHash`) may have no off-chain counterpart (acceptable)

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
