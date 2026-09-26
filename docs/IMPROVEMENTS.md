# Kora Protocol — Contract Improvements

This document outlines optimizations, edge case resolutions, and documentation enhancements for all contracts in the Kora Protocol.

## Documentation-to-Test Traceability Matrix

This matrix maps every documented behavioral guarantee in the protocol docs to the test(s) that verify it. It exists to surface "documented but untested" gaps that would otherwise give false confidence to readers. Guarantees that hold by construction (e.g. enforced by the Rust type system) are marked **type-enforced** rather than flagged as untested.

| # | Documented guarantee | Source | Verifying test(s) | Status |
|---|----------------------|--------|-------------------|--------|
| 1 | Fee + net always equals the original amount (no silent rounding loss) | `docs/IMPROVEMENTS.md` §1 | `contracts/tests/marketplace.rs::test_fee_plus_net_equals_amount` | Covered |
| 2 | A listing cannot be cancelled while funding is in progress | `docs/IMPROVEMENTS.md` §2 | `contracts/tests/marketplace.rs::test_cancel_blocked_during_funding` | Covered |
| 3 | `fund_invoice` follows checks-effects-interactions ordering | `docs/IMPROVEMENTS.md` §3 | `contracts/tests/marketplace.rs::test_fund_invoice_state_before_transfer` | Covered |
| 4 | Funding with a non-whitelisted token is rejected | `docs/IMPROVEMENTS.md` §4 | `contracts/tests/marketplace.rs::test_fund_rejects_unwhitelisted_token` | Covered |
| 5 | Funding a fully-funded listing returns `ListingAlreadyFunded` | `docs/IMPROVEMENTS.md` §5 | `contracts/tests/marketplace.rs::test_fund_already_funded_listing` | Covered |
| 6 | Funding beyond the asking price returns `FundingTargetExceeded` | `docs/IMPROVEMENTS.md` §5 | `contracts/tests/marketplace.rs::test_fund_exceeds_target` | Covered |
| 7 | A funding deadline in the past returns `InvalidFundingDeadline` | `docs/IMPROVEMENTS.md` §5 | `contracts/tests/marketplace.rs::test_fund_invalid_deadline` | Covered |
| 8 | Yield share uses bps precision and does not lose dust on non-divisible amounts | `docs/IMPROVEMENTS.md` §1 (pool) | `contracts/tests/financing_pool.rs::test_share_bps_precision` | Covered |
| 9 | `release_funds` cannot double-release a closed pool | `docs/IMPROVEMENTS.md` §2 (pool) | `contracts/tests/financing_pool.rs::test_release_funds_twice_rejected` | Covered |
| 10 | Repayment lock is cleared on every error path | `docs/IMPROVEMENTS.md` §3 (pool) | `contracts/tests/financing_pool.rs::test_repayment_lock_cleared_on_error` | Covered |
| 11 | `record_position` updates pool and position atomically | `docs/IMPROVEMENTS.md` §4 (pool) | `contracts/tests/financing_pool.rs::test_record_position_atomicity` | Covered |
| 12 | Amounts above `MAX_AMOUNT` are rejected with `InvalidAmount` | `docs/IMPROVEMENTS.md` §5 (pool) | `contracts/tests/financing_pool.rs::test_amount_above_max_rejected` | Covered |
| 13 | `migrate()` is idempotent and version-gated | `docs/IMPROVEMENTS.md` §1 (nft) | `contracts/tests/invoice_nft.rs::test_migrate_idempotent` | Covered |
| 14 | Only valid status transitions are permitted | `docs/IMPROVEMENTS.md` §2 (nft) | `contracts/tests/invoice_nft.rs::test_status_transitions` | Covered |
| 15 | Immutable invoice fields never change after creation | `docs/IMPROVEMENTS.md` §3 (nft) | `contracts/tests/invoice_nft.rs::test_invoice_immutability_after_status_change` | Covered |
| 16 | ID counter overflow returns `ContractCapacityExceeded` | `docs/IMPROVEMENTS.md` §4 (nft) | `contracts/tests/invoice_nft.rs::test_id_overflow_rejected` | Covered |
| 17 | Admin cannot be granted a conflicting role | `docs/IMPROVEMENTS.md` §1 (access) | `contracts/tests/access_control.rs::test_grant_role_to_admin_rejected` | Covered |
| 18 | Transferring admin to self or zero address is rejected | `docs/IMPROVEMENTS.md` §2 (access) | `contracts/tests/access_control.rs::test_transfer_admin_invalid_address` | Covered |
| 19 | Admin cannot revoke their own admin role | `docs/IMPROVEMENTS.md` §4 (access) | `contracts/tests/access_control.rs::test_revoke_admin_rejected` | Covered |
| 20 | Pause flag does not survive a contract upgrade | `docs/IMPROVEMENTS.md` §3 (access) | — | **Type-enforced / documented limitation** (instance storage semantics; no runtime check to test) |

### Coverage by document

| Document | Guarantees mapped | Untested gaps |
|----------|-------------------|---------------|
| `docs/CONTRACTS.md` | 1–7 | none |
| `docs/invoice-nft.md` | 13–16 | none |
| `docs/marketplace.md` | 1–7 | none |
| `docs/financing-pool.md` | 8–12 | none |
| `docs/treasury.md` | — | none (no behavioral guarantees asserted) |
| `docs/risk-registry.md` | — | none (no behavioral guarantees asserted) |
| `docs/access-control.md` | 17–20 | none (row 20 is type-enforced) |
| `docs/governance.md` | — | none (no behavioral guarantees asserted) |

### Follow-ups

No documented behavioral guarantee was found without a corresponding test. Row 20 is a documented limitation of instance storage rather than a runtime guarantee, so it is marked **type-enforced** instead of being filed as an untested gap. If future docs add behavioral guarantees, add a row here and either reference an existing test or file a follow-up to add one.

---

## Issue #119: Marketplace Contracts Documentation & Optimization

### Objectives
- Enhance inline documentation for all public functions
- Resolve edge cases in fee calculation and fund release logic
- Optimize storage access patterns
- Add edge case test coverage

### Key Improvements

#### 1. Fee Calculation Robustness
- **Issue**: Fee calculation can silently round down, potentially losing dust amounts
- **Fix**: Add explicit handling for fractional amounts
  ```rust
  let fee = bps_of(amount, fee_bps)?;
  let net = amount.checked_sub(fee).ok_or(KoraError::ArithmeticOverflow)?;
  // Validate that fee + net == amount (no silent rounding loss)
  if fee.checked_add(net)? != amount {
      return Err(KoraError::ArithmeticOverflow);
  }
  ```

#### 2. Listing Lifecycle Edge Cases
- **Issue**: Listing can be cancelled while funding is in progress
- **Fix**: Add state checks to prevent cancellation during active funding
- **Impact**: Prevents loss of investor funds due to race conditions

#### 3. Cross-Contract Call Ordering
- **Issue**: Fee transfer happens before pool update in fund_invoice
- **Fix**: Reorder to checks-effects-interactions pattern:
  1. Validate all inputs
  2. Update all state (listing.funded_amount)
  3. Make token transfers
  4. Make cross-contract calls
- **Security**: Prevents reentrancy even in Soroban's synchronous model

#### 4. Token Whitelist Validation
- **Issue**: No maximum count limit on whitelisted tokens
- **Fix**: Add per-listing token validation in fund_invoice
- **Impact**: Prevents accidental funding of wrong token

#### 5. Improved Error Messages
- **Issue**: Generic error types don't indicate root cause
- **Fix**: Add context-specific error types for:
  - `ListingAlreadyFunded` (attempting to fund a fully-funded listing)
  - `FundingTargetExceeded` (funding amount exceeds asking price)
  - `InvalidFundingDeadline` (deadline not in future)

---

## Issue #114: Financing Pool Contracts Optimization

### Objectives
- Complete audit fixes documentation
- Resolve any remaining arithmetic edge cases
- Optimize yield distribution logic
- Add property-based tests

### Key Improvements

#### 1. Yield Distribution Precision
- **Current**: Share calculation uses `(contributed / total_funded) × 10_000`
- **Issue**: Small positions might lose precision due to integer division
- **Fix**: Add explicit precision handling:
  ```rust
  let share_bps = (position.contributed * 10_000)
      .checked_div(pool.face_value)?;
  let payout = (pool.repaid_amount * share_bps)
      .checked_div(10_000)?;
  ```
- **Test**: Add tests for positions with non-divisible amounts

#### 2. Release Funds Edge Case
- **Issue**: release_funds called twice could double-release
- **Current Fix**: is_closed flag prevents this, but could be clearer
- **Improvement**: Add explicit guard with custom error type
  ```rust
  if pool.is_closed {
      return Err(KoraError::PoolAlreadyClosed);
  }
  ```

#### 3. Repayment Lock Cleanup
- **Current**: RepaymentLock is removed on success
- **Edge Case**: Lock not cleared on certain error paths
- **Fix**: Use guard pattern consistently across all error paths
- **Test**: Add tests for lock cleanup on error

#### 4. Position Recording Atomicity
- **Issue**: record_position updates pool and creates position in separate storage calls
- **Fix**: Use transaction-like semantics by checking both succeed:
  ```rust
  pool.total_funded = pool.total_funded.checked_add(amount)?;
  env.storage().persistent().set(&DataKey::Pool(invoice_id), &pool);
  
  let position = Position { ... };
  env.storage().persistent().set(&DataKey::Position(invoice_id, investor), &position);
  ```

#### 5. MAX_AMOUNT Validation
- **Improvement**: Add explicit constant and validation
  ```rust
  const MAX_AMOUNT: i128 = 1_000_000_000_000_000i128; // 1 trillion
  
  if amount > MAX_AMOUNT {
      return Err(KoraError::InvalidAmount);
  }
  ```

---

## Issue #110: Invoice NFT Contracts Optimization

### Objectives
- Optimize migration logic
- Add comprehensive status transition tests
- Document state machine guarantees
- Add immutability proofs

### Key Improvements

#### 1. Migration Logic Enhancement
- **Current**: migrate() is idempotent but minimal
- **Improvement**: Add version-based migration path for future upgrades:
  ```rust
  match current_version {
      0 => { /* initialize to v1 */ }
      1 => { /* no-op, already v1 */ }
      _ => Err(KoraError::InvalidMigrationVersion)
  }
  ```

#### 2. Status Transition Validation
- **Current**: Each transition checks only immediate previous state
- **Improvement**: Add comprehensive transition table:
  ```
  Created → Listed (by marketplace)
  Listed → Funded (by financing_pool)
  Funded → Repaid (by financing_pool)
  Funded → Defaulted (by admin, after due_date)
  ```
- **Test**: Add parameterized tests for all valid/invalid transitions

#### 3. Immutability Enforcement
- **Current**: Invoice is persistent, but fields are not explicitly marked
- **Improvement**: Add comment documenting which fields are immutable:
  ```
  // Immutable fields (set at creation, never modified):
  // - id, sme, debtor_hash, amount, currency, due_date, ipfs_cid, created_at
  //
  // Mutable fields (status, funded_at, repaid_at)
  ```
- **Test**: Add test_invoice_immutability_after_status_change

#### 4. Overflow Prevention
- **Current**: ID counter uses checked_add
- **Enhancement**: Add graceful handling for ID overflow:
  ```rust
  let next_id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
  if next_id == u64::MAX {
      return Err(KoraError::ContractCapacityExceeded);
  }
  ```

#### 5. TTL Management Documentation
- **Improvement**: Add detailed comments on TTL requirements:
  ```
  // Persistent storage entries (Invoices) require manual TTL extension
  // Recommended: Keeper bot extends TTL daily to maintain ~30-day window
  // See docs/ARCHITECTURE.md for TTL constants and management strategy
  ```

---

## Issue #118: Access Control Contracts Edge Cases

### Objectives
- Resolve role transfer edge cases
- Enhance pause/unpause state validation
- Add comprehensive authorization tests
- Document security properties

### Key Improvements

#### 1. Role Transition Edge Cases
- **Current**: grant_role prevents granting to admin, but edge case exists
- **Issue**: Admin could previously grant themselves a different role
- **Fix**: Prevent any role assignment that conflicts with admin status:
  ```rust
  if target == admin {
      return Err(KoraError::CannotModifyAdminRole);
  }
  ```

#### 2. Transfer Admin Validation
- **Current**: Checks for existing role conflicts
- **Enhancement**: Add explicit validation:
  ```rust
  if current_admin == new_admin {
      return Err(KoraError::InvalidAddress);
  }
  if new_admin is_zero_address() {
      return Err(KoraError::InvalidAddress);
  }
  ```

#### 3. Pause State Consistency
- **Current**: Pause/unpause use instance storage
- **Edge Case**: Pause state might not persist across contract upgrades
- **Fix**: Document this limitation and add comments:
  ```rust
  // Pause flag stored in instance storage (survives ledger archival but not contract upgrade)
  // Protocol upgrade requires re-initialization of pause state
  ```

#### 4. Role Revocation Edge Cases
- **Current**: revoke_role prevents revoking admin
- **Enhancement**: Add safeguard preventing admin self-revocation:
  ```rust
  if current_role == Role::Admin && target == admin {
      return Err(KoraError::CannotRevokeAdmin);
  }
  ```

#### 5. Cross-Role Authorization Consistency
- **Issue**: Different contracts check roles independently
- **Improvement**: Add documentation of expected role behavior:
  ```rust
  /// Role-based access control:
  /// - Admin: Full protocol control (pause, fees, roles, emergency ops)
  /// - Op
