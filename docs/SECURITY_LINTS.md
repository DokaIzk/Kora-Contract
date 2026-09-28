# Security-Relevant Clippy Lints

This document explains the security-focused Clippy lints enforced across the Kora codebase and provides guidance on when suppressions are acceptable.

## Overview

As part of the security hardening wave, we've promoted a curated set of security-relevant Clippy lints from warnings to **deny** status. These lints prevent entire classes of bugs that could lead to:

- Production panics and DoS vulnerabilities
- Arithmetic overflow/underflow exploits
- Silent data loss or corruption
- Unsafe memory operations

All existing violations have been fixed to establish a clean baseline. The CI `make lint` gate enforces these rules on every PR.

---

## Lint Categories

### 1. Arithmetic Safety

**Goal:** Prevent arithmetic operations that could overflow, wrap, or truncate without explicit checks.

| Lint | Level | What It Catches |
|------|-------|-----------------|
| `arithmetic_side_effects` | deny | Unchecked `+`, `-`, `*`, `/`, `%` operations |
| `integer_arithmetic` | deny | Integer arithmetic without explicit overflow handling |
| `cast_possible_truncation` | deny | Casting from larger to smaller int (e.g., `i64 as i32`) |
| `cast_possible_wrap` | deny | Casting unsigned to signed where wrapping could occur |
| `cast_precision_loss` | warn | Float-to-int or int-to-float conversions losing precision |

**Why:** Soroban contracts handle financial values where arithmetic errors can directly lead to fund loss. Rust's default overflow behavior differs between debug (panic) and release (wrap), making unchecked arithmetic a landmine.

**Correct pattern:**

```rust
// ❌ BAD: Unchecked addition
let total = amount1 + amount2;

// ✅ GOOD: Explicit checked arithmetic
let total = amount1.checked_add(amount2)
    .ok_or(Error::ArithmeticOverflow)?;

// ✅ GOOD: Using validated safe_add helper (from kora_shared::validation)
let total = safe_add(amount1, amount2)?;
```

**When to suppress:** Never. If arithmetic can't overflow given invariants, document why and use `saturating_*` or `checked_*` methods to make intent explicit.

---

### 2. Panic Safety

**Goal:** Eliminate all panicking code paths from production contract logic.

| Lint | Level | What It Catches |
|------|-------|-----------------|
| `unwrap_used` | deny | `.unwrap()` calls |
| `expect_used` | deny | `.expect("msg")` calls |
| `indexing_slicing` | deny | Direct indexing `vec[i]` or slicing `&arr[a..b]` |
| `panic` | deny | Explicit `panic!()` macro |
| `todo` | deny | `todo!()` placeholders in production code |
| `unimplemented` | deny | `unimplemented!()` stubs |
| `unreachable` | deny | `unreachable!()` assertions |

**Why:** A panic in a Soroban contract aborts the transaction and can lock funds or create DoS conditions. Every code path must handle errors gracefully.

**Correct pattern:**

```rust
// ❌ BAD: Panics if key missing
let value = map.get(&key).unwrap();

// ✅ GOOD: Explicit error handling
let value = map.get(&key)
    .ok_or(Error::KeyNotFound)?;

// ❌ BAD: Panics on out-of-bounds
let first = vec[0];

// ✅ GOOD: Checked access
let first = vec.get(0)
    .ok_or(Error::EmptyVec)?;
```

**When to suppress:** Only in test code (`#[cfg(test)]`) where panics are acceptable. Use `#[allow(clippy::unwrap_used)]` with a comment explaining why the test setup guarantees the unwrap is safe.

---

### 3. Memory & Unsafe Safety

**Goal:** Require explicit documentation for all unsafe operations.

| Lint | Level | What It Catches |
|------|-------|-----------------|
| `undocumented_unsafe_blocks` | deny | `unsafe { }` blocks without safety comments |
| `multiple_unsafe_ops_per_block` | deny | Multiple unsafe operations in one block (reduces auditability) |

**Why:** Unsafe code bypasses Rust's safety guarantees and requires manual verification. Clear documentation is essential for security audits.

**Correct pattern:**

```rust
// ❌ BAD: Undocumented unsafe
let ptr = unsafe { slice.get_unchecked(index) };

// ✅ GOOD: Documented invariant
// SAFETY: index is guaranteed to be < slice.len() by the preceding bounds check
let ptr = unsafe { slice.get_unchecked(index) };
```

**When to suppress:** Never. If using unsafe, document why it's safe.

---

### 4. Logic & Correctness

**Goal:** Prevent silent bugs from ignored results or type conversions.

| Lint | Level | What It Catches |
|------|-------|-----------------|
| `unused_results` | deny | Ignoring `Result<T, E>` return values |
| `must_use_candidate` | warn | Functions that should have `#[must_use]` attribute |
| `float_cmp` | warn | Direct float equality comparisons (`f1 == f2`) |
| `range_plus_one` | warn | Ranges like `0..len+1` (should be `0..=len`) |

**Why:** Ignored error results hide failures. Lossy conversions lose data silently.

**Correct pattern:**

```rust
// ❌ BAD: Ignored result
token.transfer(&from, &to, &amount);

// ✅ GOOD: Error propagated
token.transfer(&from, &to, &amount)?;

// ❌ BAD: Float comparison
if price1 == price2 { ... }

// ✅ GOOD: Epsilon comparison
if (price1 - price2).abs() < EPSILON { ... }
```

---

## Suppression Policy

### When Suppressions Are Acceptable

1. **Test-only code:** Panics in test setup are fine.
   ```rust
   #[cfg(test)]
   #[allow(clippy::unwrap_used)]
   fn setup() {
       let env = Env::default();
       let addr = env.register_contract(None, Contract).unwrap(); // test setup
   }
   ```

2. **Provably safe operations:** When invariants guarantee safety.
   ```rust
   // JUSTIFICATION: BPS values are validated to be <= 10_000, so division is safe
   #[allow(clippy::integer_arithmetic)]
   let amount = principal * bps / 10_000;
   ```

3. **Upstream library limitations:** When external crate forces unsafe/unwrap.
   ```rust
   // JUSTIFICATION: soroban_sdk::Map::get() API requires .unwrap_or() pattern
   #[allow(clippy::unwrap_used)]
   let value = map.get(&key).unwrap_or(default);
   ```

### Suppression Format

Always use narrow, inline suppressions with justification:

```rust
// ✅ GOOD: Narrow scope, justified
#[allow(clippy::indexing_slicing)] // Guaranteed in-bounds by preceding len() check
let item = &vec[index];

// ❌ BAD: Blanket module-level suppression
#![allow(clippy::unwrap_used)] // at top of file — TOO BROAD
```

### Review Requirements

PRs adding `#[allow(clippy::...)]` for security lints require:
1. Inline comment explaining WHY the suppression is safe
2. Reviewer verification of the justification
3. Consider refactoring to avoid suppression if possible

---

## CI Enforcement

The `make lint` command runs:
```bash
cargo clippy --all --all-targets -- -D warnings
```

This treats all configured `deny` lints as errors, failing the build on any violation.

To check locally before committing:
```bash
make lint
```

To see all lint violations without failing:
```bash
cargo clippy --all --all-targets
```

---

## Fixing Common Violations

### Replace unwrap() with error handling

**Before:**
```rust
pub fn get_position(env: Env, pool_id: u64, investor: Address) -> Position {
    let positions = env.storage().persistent().get(&DataKey::Positions(pool_id)).unwrap();
    positions.get(&investor).unwrap()
}
```

**After:**
```rust
pub fn get_position(env: Env, pool_id: u64, investor: Address) -> Result<Position, Error> {
    let positions = env.storage().persistent()
        .get(&DataKey::Positions(pool_id))
        .ok_or(Error::PoolNotFound)?;
    positions.get(&investor)
        .ok_or(Error::PositionNotFound)
}
```

### Replace direct arithmetic with checked operations

**Before:**
```rust
let total_fees = base_fee + referral_fee;
let yield_share = amount * bps / 10_000;
```

**After:**
```rust
let total_fees = base_fee.checked_add(referral_fee)
    .ok_or(Error::ArithmeticOverflow)?;

// Use helper from kora_shared::validation
let yield_share = bps_of(amount, bps)?;
```

### Replace indexing with safe access

**Before:**
```rust
let first_investor = positions[0];
let slice = &data[start..end];
```

**After:**
```rust
let first_investor = positions.get(0)
    .ok_or(Error::NoInvestors)?;

let slice = data.get(start..end)
    .ok_or(Error::InvalidRange)?;
```

---

## Testing Lint Compliance

The test suite includes a dedicated lint validation target:

```bash
# Run security lint check
make lint

# Check specific package
cargo clippy -p kora-marketplace -- -D warnings

# Check with all features enabled
cargo clippy --all-features --all-targets -- -D warnings
```

---

## Related Documentation

- [Cargo Clippy Lint List](https://rust-lang.github.io/rust-clippy/master/index.html)
- [Soroban SDK Best Practices](https://soroban.stellar.org/docs/learn/best-practices)
- `docs/ARCHITECTURE.md` § Error Handling
- `contracts/shared/src/validation.rs` — Safe arithmetic helpers

---

## Changelog

**Security Hardening Wave (2026-09):**
- Initial security lint configuration
- Fixed all existing violations across contracts/* and sdk/
- Established clean baseline enforced by CI

For questions or exceptions, discuss in #dev-security or open an issue with `security` label.
