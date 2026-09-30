# Kora Protocol — Performance & WASM Size Budgets

This document outlines WASM size budgets, optimization guidelines, and the approval process for budget increases.

## Per-Contract WASM Size Budgets

Soroban enforces strict upper bounds on deployed WASM size. To avoid late-stage rework, Kora enforces committed per-contract size budgets in CI (`.github/workflows/wasm-size.yml` & `wasm-budgets.json`):

| Contract | Size Budget | Purpose / Description |
|---|---|---|
| `access_control` | 120 KB (122,880 B) | Role & multisig admin governance |
| `invoice_nft` | 120 KB (122,880 B) | NFT minting & lifecycle state |
| `risk_registry` | 120 KB (122,880 B) | SME risk profiles & verifier registry |
| `treasury` | 120 KB (122,880 B) | Protocol fees & reserve management |
| `financing_pool` | 150 KB (153,600 B) | Funding & yield distribution math |
| `marketplace` | 150 KB (153,600 B) | Two-phase listing & order matching |
| `price_oracle` | 100 KB (102,400 B) | FX & valuation feed aggregator |
| `tranche` | 100 KB (102,400 B) | Tranche tokenization |
| `dispute_resolution` | 120 KB (122,880 B) | Escrow dispute arbitration |

---

## Size Budget CI Enforcement & Override Process

1. **CI Verification**: Every PR triggers `.github/workflows/wasm-size.yml` which executes `scripts/check-wasm-size.sh`.
2. **Budget Breach**: If a compiled WASM exceeds its budget in `wasm-budgets.json`, CI fails with an overage report.
3. **Budget Increase Approval Process**:
   - If a feature legitimately requires increasing a contract's budget, apply the `wasm-size-increase-approved` label to the PR.
   - Update `wasm-budgets.json` in the PR with the new limit and document the justification in the PR description.
