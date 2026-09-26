# Keeper Service

**Issue #765 — Background Job Queue for Deadline-Based Contract Triggers**

A resilient background keeper that watches on-chain deadlines (funding expiry, invoice due dates, grace-period end) and automatically submits the appropriate **permissionless** trigger transactions so users do not have to monitor the chain manually.

---

## Architecture

```
Indexer (deadline data)
        │
        ▼
  Scheduler.enqueueDeadlines()
        │
        ▼
  JobStore (SQLite, dedup_key UNIQUE)
        │  promoteExpired() on every tick
        ▼
  Dispatcher.dispatch()
        │
        ├─ submitted      → job: in_flight
        ├─ already_triggered (no-op) → job: done
        ├─ failed (transient) → retry with exponential back-off
        └─ permanent_failure → job: dead (dead-letter queue)
```

### Key design decisions

| Concern | Decision |
|---|---|
| Deduplication across restarts | `INSERT OR IGNORE` on `dedup_key` (SQLite UNIQUE) — a restart never re-enqueues |
| Already-triggered detection | Known no-op error codes (`AlreadyDefaulted`, `AlreadyRefunded`, etc.) are treated as `done`, not `failed` |
| Rate limiting | Token-bucket: max 10 tx/min on the keeper account |
| Fee bumping | Base 100 stroops × 1.1^attempts, capped at 10 000 stroops |
| Retry back-off | Exponential: `backoffBaseMs × 2^(attempts-1)` |
| Dead-letter | After `maxAttempts` failures, job is moved to `dead` for manual inspection |

---

## Configuration

| Env var | Default | Description |
|---|---|---|
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `KEEPER_SECRET` | _(required)_ | Ed25519 secret key of keeper account |
| `KEEPER_DB_PATH` | `./keeper-jobs.db` | SQLite file path |
| `KEEPER_POLL_INTERVAL_MS` | `30000` | Tick interval (ms) |
| `KEEPER_MAX_ATTEMPTS` | `5` | Attempts before dead-letter |
| `KEEPER_RETRY_BACKOFF_BASE_MS` | `60000` | Back-off base (ms) |
| `KEEPER_HTTP_PORT` | `8080` | Observability HTTP port |
| `STELLAR_NETWORK_PASSPHRASE` | testnet | Network passphrase |

---

## Observability endpoints

| Path | Description |
|---|---|
| `GET /health` | Liveness check |
| `GET /status` | Job counts by status |
| `GET /history` | Last 200 job records |

---

## Running

```bash
npm install
npm run build
KEEPER_SECRET=S... npm start
```

## Testing

```bash
npm test
```

Minimum 90% line/branch/function/statement coverage enforced.
