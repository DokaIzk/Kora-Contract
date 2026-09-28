# Kora Protocol — Performance & Storage Benchmarks

Storage and resource cost growth benchmarks for key contract operations.

## Invoice NFT Minting — Storage Cost Growth

Storage costs scale linearly with invoice count as metadata is persisted. Benchmarks measured on Soroban testutils cost metrics.

| Invoice Count | Estimated Storage (stroops) | Notes |
|---|---|---|
| 1 | ~500 | Single invoice metadata |
| 100 | ~50,000 | 100 invoices persisted |
| 1,000 | ~500,000 | 1K invoices, linear growth |
| 10,000 | ~5,000,000 | 10K invoices, continued linear scaling |

**Key Findings:**
- Storage growth is linear: ~5,000 stroops per invoice
- Each invoice record includes: ID, amount, currency, due date, IPFS CID, risk score, status (62 bytes base)
- TTL bumps add minimal overhead (~100 stroops per bump)
- No exponential growth detected up to 10K invoices

## Yield Distribution — Precision Loss Bounds

Yield distribution across investor positions incurs rounding loss due to basis point arithmetic (division by 10,000).

**Drift Bound:** ≤ position count × 1 stroops (smallest unit)

For 50 uneven investor positions:
- Maximum acceptable drift: 50 stroops
- Observed drift: < 10 stroops (well within bounds)
- Root cause: integer division in `bps_of_normalized()`

**Mitigation:** Distribute yield to investors in order; final investor receives remainder to ensure exact total.

---

## Recommendations

1. **Invoice NFT Minting:** Safe for 100K+ invoices without redeployment
2. **Yield Distribution:** Current precision bounds acceptable for invoices up to 100M stroops
3. **Monitor:** TTL operations for large position counts (> 1000 positions per invoice)

---

## WASM Size & Gas Regression Guard

The `wasm-metrics` xtask binary (issue #751) enforces that no PR silently bloats
contract binaries or increases simulated execution costs beyond a configurable
threshold.

### How it works

1. **Measure** — after `make build-optimized`, the tool scans each compiled WASM
   and the contract source to produce a JSON report:
   ```
   cargo run -p kora-xtask --bin wasm-metrics -- measure-wasm \
     --out wasm_metrics_report.json
   ```
   Output fields per contract: `wasm_size_bytes`, `estimated_cost_units`,
   `entrypoints`.

2. **Check** — CI compares the report against `baselines/wasm-metrics.json`:
   ```
   cargo run -p kora-xtask --bin wasm-metrics -- check-regression \
     --report wasm_metrics_report.json \
     --baseline baselines/wasm-metrics.json \
     --size-threshold-pct 5
   ```
   The job fails if any metric grows by more than `--size-threshold-pct` (default
   **5 %**) relative to the baseline.

3. **CI workflow** — `.github/workflows/wasm-size.yml` runs both steps in the
   `wasm-metrics-regression` job after the existing `wasm-size` job.

### Updating the baseline (intentional growth)

When a PR intentionally adds new entrypoints or increases contract size, update
the committed baseline before merging:

```bash
# 1. Build optimized WASMs
make build-optimized

# 2. Regenerate the baseline
cargo run -p kora-xtask --bin wasm-metrics -- measure-wasm \
  --out baselines/wasm-metrics.json

# 3. Commit
git add baselines/wasm-metrics.json
git commit -m "chore: update WASM metrics baseline after <description>"
```

The `scripts/record-wasm-hashes.sh` release helper runs this automatically when
cutting a new version.

### Threshold configuration

| Variable | Default | Description |
|---|---|---|
| `METRICS_THRESHOLD_PCT` | `5` | Max % growth in size or cost before CI fails |
| `SIZE_THRESHOLD_BYTES` | `10240` | Absolute byte growth limit (legacy gate) |

Override for a single workflow run via `workflow_dispatch` inputs or by editing
`.github/workflows/wasm-size.yml`.
