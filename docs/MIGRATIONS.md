# Contract storage migrations

WASM upgrades and storage migrations are separate operations. Upgrading a contract does **not** migrate its state. After deploying new WASM, an administrator calls the contract's explicit migration entrypoint and verifies the stored version.

## Standard framework

`contracts/shared/src/migration.rs` supplies:

| Helper | Purpose |
| --- | --- |
| `read_version(env, key)` | Read the instance `SchemaVersion` key; missing means legacy version `0`. |
| `read_current<T>(env, version_key, value_key, expected)` | Refuse to deserialize a value with the current codec while storage is at another version. Migration steps should read legacy values using legacy types. |
| `migrate(env, key, from, to, SCHEMA_VERSION, step)` | Check the source and target, execute each adjacent step, and store the new version after each successful step. Returns `false` if already at target. |

Each adopting contract declares a compile-time `SCHEMA_VERSION`, stores the version in **instance storage** on fresh initialization, and exposes an admin-authorized `migrate_versions(admin, from_version, to_version)` entrypoint. The entrypoint dispatches explicit `(old, new)` steps. Unknown steps fail. The shared helper rejects a mismatched stored source, a backwards target, zero, or a target newer than the installed WASM. Calls at the target are no-ops, even when the caller supplies an older `from_version`.

The reference implementations are:

| Contract | Current version | Steps |
| --- | ---: | --- |
| `invoice_nft` | 2 | `0→1` establishes the baseline; `1→2` backfills legacy invoices with `notes: None`. The existing `migrate(admin)` remains as a compatibility wrapper. |
| `financing_pool` | 1 | `0→1` records the baseline without changing pool encodings. |
| `marketplace` | 1 | `0→1` records the baseline without changing listing encodings. |

### Adding the next version

1. Keep the previous `#[contracttype]` definition when a stored value changes shape. Add `old→new` conversion code that reads it using the old type.
2. Increment that contract's `SCHEMA_VERSION`, add an adjacent step, and make fresh `initialize` write the new version.
3. Add tests for the individual step, a multi-step jump from the oldest supported version, a repeated call, invalid ranges, and a value read with the wrong codec. Check all relevant storage keys and TTL behavior.
4. Upgrade the WASM through the contract's normal timelocked upgrade procedure. Separately call `migrate_versions(admin, stored_version, SCHEMA_VERSION)`. Verify the resulting version and inspect representative records before enabling new callers.

For example, a future v3 contract migrating v1 data runs `1→2` and then `2→3` in order. The shared helper updates the version only after each step succeeds. An error from a contract entrypoint reverts that invocation; the operator should investigate it before retrying. A migration that scans large collections may need a separate paginated design to fit Soroban resource limits; the invoice NFT v1→v2 step currently iterates allocated invoice IDs.

## Upgrade security and operations

Contract WASM changes still use their existing upgrade proposal, delay, execution, and cancellation controls. A migration call requires the adopting contract's administrator and is **never** invoked automatically by the WASM upgrade. Check the new WASM hash and storage version independently. Do not assume all contracts share the same numeric schema version.

The shared migration module does not replace `contracts/shared/src/timelock.rs` or an existing contract's authorization and governance rules. Operators should record the deployed WASM hash, old and target versions, migration transaction, and post-migration read checks for each contract.
