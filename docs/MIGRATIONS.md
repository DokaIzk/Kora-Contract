# Contract Migrations & Timelocked Upgrades

This document describes the standardized, timelocked upgrade mechanism used across
all Kora contracts. It is the reference for operators, auditors, and integrators
who need to understand how WASM upgrades and storage migrations are proposed,
reviewed, and executed.

## Motivation

Instant, admin-triggered upgrades are a major trust concern for institutional
investors (see `THREAT_MODEL.md`). A timelock gives the community and auditors a
window to review and react to a proposed upgrade before it takes effect. Every
upgrade is therefore:

1. **Proposed** on-chain and publicly visible.
2. **Delayed** by a configurable, admin-set interval.
3. **Executable** only after the delay has elapsed.
4. **Cancellable** by the admin before execution.

On-chain governance voting over upgrades is intentionally out of scope here and
is tracked separately under Governance.

## The Shared `Timelock` Module

The mechanism lives in `contracts/shared/src/timelock.rs` and is re-exported from
`contracts/shared/src/lib.rs` so that every contract can adopt it from its upgrade
entrypoint without duplicating logic.

### Data Model

```rust
pub struct UpgradeProposal {
    pub id: u64,
    pub wasm_hash: BytesN<32>,
    pub proposer: Address,
    pub proposed_at: u64,
    pub executed: bool,
    pub cancelled: bool,
}
```

Proposals are stored in persistent storage keyed by their monotonically
increasing `id`. The configured delay is stored separately and is settable by the
admin.

### API

| Function | Description |
| --- | --- |
| `propose_upgrade(env, admin, wasm_hash) -> u64` | Records the proposed WASM hash, proposer, and `proposed_at` timestamp. Returns the new proposal `id`. Emits an `upgrade_proposed` event. |
| `execute_upgrade(env, admin, id)` | Executes a proposal only when `env.ledger().timestamp() >= proposed_at + delay`. Emits an `upgrade_executed` event. |
| `cancel_upgrade(env, admin, id)` | Cancels a pending proposal before execution. Emits an `upgrade_cancelled` event. |
| `set_upgrade_delay(env, admin, delay)` | Sets the configurable upgrade delay (admin only). |
| `get_upgrade_delay(env) -> u64` | Returns the currently configured delay. |
| `get_proposal(env, id) -> UpgradeProposal` | Returns a stored proposal for inspection. |

### Delay Semantics

- A sane default delay is applied on initialization.
- The admin may adjust the delay via `set_upgrade_delay`.
- `execute_upgrade` reverts with an early-execution error when
  `env.ledger().timestamp() < proposed_at + delay`.

### Edge Cases & Constraints

- **Early execution is rejected.** Calling `execute_upgrade` before the delay has
  elapsed fails.
- **Replay is prevented.** A proposal that has already been executed cannot be
  executed again; the `executed` flag is checked and set atomically.
- **Cancellation is supported.** A pending proposal may be cancelled by the admin
  and can no longer be executed.
- **Unknown ids are rejected.** Executing or cancelling a non-existent proposal
  fails.

## Adopting the Module in a Contract

Each contract's upgrade entrypoint should delegate to the shared module rather
than performing an immediate upgrade:

```rust
// propose
let id = timelock::propose_upgrade(&env, admin.clone(), new_wasm_hash.clone());

// later, after the delay has elapsed
let proposal = timelock::get_proposal(&env, id);
if env.ledger().timestamp() < proposal.proposed_at + timelock::get_upgrade_delay(&env) {
    panic!("upgrade delay has not elapsed");
}
timelock::execute_upgrade(&env, admin.clone(), id);
```

## Events

Both proposal and execution emit events so that off-chain monitors and the
community can observe the full lifecycle:

- `upgrade_proposed` — emitted when a proposal is created.
- `upgrade_executed` — emitted when a proposal is executed.
- `upgrade_cancelled` — emitted when a proposal is cancelled.

## Testing Requirements

Adopting contracts must maintain a minimum of 90% coverage over the timelock
paths. At a minimum, tests must cover:

- **Early-execution rejection** — executing before the delay elapses fails.
- **Cancellation** — a cancelled proposal cannot be executed.
- **Successful post-delay execution** — a proposal executes once the delay has
  elapsed.
- **Replay prevention** — an executed proposal cannot be executed again.

## Operational Checklist

1. Propose the upgrade and record the returned `id`.
2. Announce the proposal and the intended execution time to the community.
3. Wait for the configured delay to elapse.
4. Execute the upgrade (or cancel it if concerns are raised).
5. Verify the emitted `upgrade_executed` event and the new WASM hash.

---

## invoice_nft Storage Schema History

### v1 → v2 (notes field)

`Invoice` gained `notes: Option<String>`. Pre-existing records stored as `InvoiceV1`
(no `notes` field) are backfilled with `notes = None` by `migrate()`.

### v2 → v3 — Hot/Cold Storage Split (issue #740)

**Motivation:** Every status transition (`set_listed`, `set_funded`, `set_repaid`,
`set_defaulted`) previously read and wrote the full `Invoice` struct, including
large cold fields (`debtor_hash` up to 64 bytes, `ipfs_cid` up to 128 bytes,
`metadata_hash` up to 32 bytes, `notes`). These fields are never needed during
a status transition, so each call paid unnecessary ledger I/O cost.

**Change:** The monolithic `Invoice(id)` persistent key is split into two keys:

| Key | Type | Fields | Access pattern |
|---|---|---|---|
| `InvoiceHot(id)` | persistent | `id`, `sme`, `amount`, `currency`, `due_date`, `risk_score`, `risk_tier`, `status`, `created_at`, `funded_at`, `repaid_at` | Every status transition, exposure tracking, freeze checks |
| `InvoiceCold(id)` | persistent | `debtor_hash`, `ipfs_cid`, `metadata_hash`, `notes` | `get_invoice`, `amend_invoice`, `update_metadata_cid`, `commit_metadata_hash`, `flag_metadata_mismatch` |

`get_invoice` merges both keys into the public `Invoice` type — the external
interface is unchanged and verified by `interface-compat.yml`.

**Before/After resource estimates (per status transition call):**

| Metric | v2 (full Invoice) | v3 (hot only) | Reduction |
|---|---|---|---|
| Persistent reads | 1 × ~300 byte struct | 1 × ~120 byte struct | ~60% |
| Persistent writes | 1 × ~300 byte struct | 1 × ~120 byte struct | ~60% |
| XDR decode cost | full Invoice fields | hot fields only | ~60% |
| `get_invoice` reads | 1 key | 2 keys (hot + cold) | +1 read (acceptable) |

**Migration runbook (v2 → v3):**

1. Deploy the new WASM (after the 24-hour timelock via `propose_upgrade` / `execute_upgrade`).
2. Call `migrate(admin)` immediately after the WASM swap.
   - The function iterates every allocated invoice ID.
   - For each `Invoice(id)` record found, it writes `InvoiceHot(id)` and `InvoiceCold(id)`,
     then removes the legacy `Invoice(id)` key to reclaim rent.
   - Records already migrated (hot key present) are skipped — the function is idempotent.
3. If the invoice count is very large, `migrate()` may need to be called in batches
   (the function processes all IDs in a single call; split by calling it multiple times
   if the ledger CPU budget is exceeded — idempotency ensures safety).
4. Verify: `get_invoice(id)` must return correct data for a sample of IDs.
5. Verify: legacy `Invoice(id)` keys are absent (rent reclaimed).

**Rollback:** Not supported post-migration. The v3 WASM reads only `InvoiceHot`/`InvoiceCold`
keys. If a rollback to v2 WASM is required before `migrate()` is called, the legacy
`Invoice(id)` keys are still present and the v2 WASM will read them correctly.
Once `migrate()` has run and legacy keys are removed, a v2 WASM rollback is not safe.

**Interface compatibility:** All public function signatures are unchanged. The split
is entirely internal to storage layout. `interface-compat.yml` CI will report no
breaking changes.
