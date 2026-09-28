# Kora Protocol — Contract Upgrade & Interface Migration Guide

This document records public contract interface schema migrations, breaking changes, and versioning history.

## Migration Policy & CI Gate

To protect indexers, wallet adapters, and the SDK from silent breaking changes:

1. **Interface Compatibility Check**: On every Pull Request, `.github/workflows/interface-compat.yml` inspects contract public WASM interfaces against `main`.
2. **Additive Changes**: Adding new functions or optional struct fields is non-breaking and allowed.
3. **Breaking Changes**: Removing functions, altering parameter types, or changing enum variants is breaking.
4. **Breaking Change Acknowledgment Path**:
   - Add the `interface-break-acknowledged` label to the PR.
   - Record a new entry in the [Migration History](#migration-history) log below describing the breaking change and client migration steps.

---

## Migration History

### [v0.2.0] — Initial Soroban Contract Standardization
- **Date**: 2026-09-28
- **Contracts**: All (`access_control`, `invoice_nft`, `risk_registry`, `treasury`, `financing_pool`, `marketplace`, `price_oracle`)
- **Changes**: Standardized error codes, audit logs, and reentrancy guards across contracts.
- **Client Action**: Update `@kora/sdk` to v0.2.0.
