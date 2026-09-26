# Financing Pool

The financing pool contract manages investor deposits, invoice financing, and repayment collection for cross-border trade receivables.

## Overview

Investors deposit funds into a pool. SMEs draw financing against verified invoices. When an invoice is repaid, principal plus yield flows back to the pool and is distributed to investors. If an invoice is not repaid, it eventually transitions to a `defaulted` state.

## Pool Configuration

Pool parameters are set at initialization and govern how financing and repayment behave:

| Parameter | Type | Description |
| --- | --- | --- |
| `grace_period_days` | `u32` | Number of days after the invoice due date during which repayment is still accepted without triggering default. |
| `late_fee_bps_per_day` | `u32` | Late fee accrued per day, expressed in basis points (1 bps = 0.01%) of the invoice face value. |
| `max_late_fee_bps` | `u32` | Maximum cumulative late fee, in basis points of face value, that may accrue on a single invoice. |

These parameters are configurable per pool so that different trade corridors and risk profiles can apply terms that reflect local practice.

## Grace Period

Invoices do **not** transition straight to `defaulted` once the due date passes. Instead:

1. On the due date, the invoice enters a **grace period** of `grace_period_days`.
2. During the grace period, repayment is accepted at the normal amount owed (no late fee yet).
3. Default status is only applied **after** the grace period has fully elapsed.

This protects SMEs facing minor, common payment delays from an immediate default flag, which would otherwise damage their on-chain reputation and future access to financing.

## Late-Fee Accrual

Once the grace period has elapsed, late fees accrue **linearly** on the outstanding amount owed:

```
late_fee = face_value * late_fee_bps_per_day * days_past_grace / 10_000
```

- Fees are computed **lazily** at read or repay time using `env.ledger().timestamp()`; no scheduled job or keeper is required.
- Accrued fees are added to the amount owed and are settled together with principal on repayment.
- Accrual is capped at `max_late_fee_bps` (a configured maximum multiple of face value) to prevent unbounded growth.
- All arithmetic uses checked operations; overflow or an exceeded cap is handled explicitly rather than silently wrapping.

### Out of Scope

Compounding interest models are explicitly out of scope. Late fees accrue on the face value only, never on previously accrued fees.

## Repayment Flow

1. **Before due date** — repay face value plus yield.
2. **During grace period** — repay face value plus yield; no late fee.
3. **After grace period** — repay face value plus yield plus accrued late fee (capped).
4. **After grace period, unpaid** — the invoice may be marked `defaulted`.

## Edge Cases

- **Grace period boundary** — repayment exactly at the grace period end timestamp is treated as on time; the first late-fee unit accrues only after that instant.
- **Fee cap** — once accrued fees reach `max_late_fee_bps` of face value, no further fees accrue regardless of elapsed time.
- **Checked arithmetic** — all fee and total-owed computations use checked math and fail safely on overflow.

## Testing

Tests should cover, at minimum:

- Exact-boundary timestamps at grace period start and end.
- Fee cap enforcement (accrual stops at the configured maximum).
- Repayment during the grace period versus after it.
- Default only triggering after the grace period elapses.
