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

### Standard Upgrade Procedure

1. Propose the upgrade and record the returned `id`.
2. Announce the proposal and the intended execution time to the community.
3. Wait for the configured delay to elapse.
4. Execute the upgrade (or cancel it if concerns are raised).
5. Verify the emitted `upgrade_executed` event and the new WASM hash.
6. Call `migrate()` if the upgrade changes any `#[contracttype]` struct schemas.

### Cancelling a Pending Upgrade

If a critical issue is discovered during the timelock window:

1. **Identify the proposal id** — recorded from the `propose_upgrade` call.
2. **Call `cancel_upgrade(admin, proposal_id)`** before the delay elapses.
3. **Verify the cancellation** — check for `upgrade_cancelled` event.
4. **Communicate** — announce the cancellation and reason to the community.

Cancellation can occur at any point before execution:
- Immediately after proposal
- Halfway through the timelock window
- Just before the delay expires
- Even after the delay has elapsed but before `execute_upgrade` is called

### Rolling Back an Executed Upgrade

If an issue is discovered after an upgrade has been executed:

1. **Identify the previous WASM hash** — from reproducible build artifacts or deployment records.
2. **Propose rollback** — call `propose_upgrade(admin, previous_wasm_hash)`.
3. **Wait for timelock** — same delay applies to rollbacks (no emergency bypass).
4. **Execute rollback** — call `execute_upgrade(admin)` after delay.
5. **Verify state integrity** — confirm all contract data is accessible and unchanged.
6. **Re-migrate if needed** — call `migrate()` to ensure schema consistency.

**Critical:** Rollback reuses the same timelocked upgrade mechanism, not a separate emergency path. This ensures rollbacks face the same scrutiny and delay as upgrades, preventing hasty reversions that could compound problems.

### Post-Rollback Verification

After rolling back to a previous version:

1. **Check contract functionality** — verify all read operations work correctly.
2. **Inspect storage state** — confirm no orphaned or corrupted data.
3. **Test critical paths** — minting, funding, repayment flows still work.
4. **Review migration version** — ensure `MigrationVersion` is consistent.
5. **Monitor for issues** — watch event logs and error rates closely.

### Forward-Rollback-Forward Cycles

If a rollback is followed by a corrected upgrade:

1. **Rollback** — downgrade to previous stable version.
2. **Fix the issue** — patch the code and generate new WASM.
3. **Propose corrected upgrade** — `propose_upgrade(admin, fixed_wasm_hash)`.
4. **Wait and execute** — follow standard upgrade procedure.
5. **Verify no orphaned state** — confirm data integrity across the cycle.

All data written between the original upgrade and rollback remains accessible after re-upgrading forward, provided the storage schema is compatible.

### Storage Integrity Guarantees

The timelock rollback mechanism guarantees:

- **No data loss** — rolling back does not delete contract storage.
- **Forward compatibility** — data written on version N+1 remains readable on version N (if schema-compatible).
- **Migration idempotence** — calling `migrate()` multiple times is safe.
- **No orphaned state** — forward-rollback-forward cycles leave no dangling keys.

**Out of Scope:** Rolling back an upgrade that intentionally made incompatible storage schema changes. Such upgrades must be prevented from executing via the interface-compat gate in CI, not rolled back after the fact.

---

## Emergency Response

### If a Bad Upgrade Executes

1. **Assess impact** — determine scope of issue (data corruption? logic bug? DoS?).
2. **Pause protocol if needed** — use `access_control.pause()` to halt operations.
3. **Propose rollback immediately** — don't wait to "try to fix forward."
4. **Communicate** — notify all stakeholders of the issue and rollback plan.
5. **Wait for timelock** — resist pressure to bypass the delay.
6. **Execute rollback** — after delay elapses, downgrade to last stable version.
7. **Post-mortem** — document what went wrong and update procedures.

### If Rollback Fails

If `execute_upgrade` fails during rollback (e.g., WASM hash mismatch, storage corruption):

1. **Do not retry blindly** — diagnose the root cause.
2. **Check WASM hash** — ensure it matches the intended previous version.
3. **Inspect storage state** — use read-only queries to verify data integrity.
4. **Consult migration history** — review `MigrationVersion` and schema changes.
5. **Engage incident response** — escalate to protocol engineering team.

### Preventing Rollback Scenarios

The best rollback is one that never happens:

- **Test thoroughly** — use testnet, fuzz testing, and formal verification.
- **Stage rollouts** — deploy to canary contracts first.
- **Monitor actively** — watch event logs, error rates, and state changes.
- **Review upgrades** — multiple engineers approve WASM hash before proposal.
- **Use interface-compat checks** — catch breaking changes before they reach mainnet.

---
