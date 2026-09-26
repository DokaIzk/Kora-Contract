# FX Ingestion Service

**Issue #766 — Currency Conversion and FX Rate Ingestion Service**

Ingests FX rates for African local currencies against USDC/EURC from at least two independent data sources, cross-checks them for divergence, and publishes the consensus rate to the on-chain `price_oracle` contract via an authorized relay account.

---

## Architecture

```
ExchangeRateApiSource ─┐
                       ├─► CrossChecker ─► OracleRelay ─► price_oracle contract
CurrencyApiSource     ─┘
```

### Key design decisions

| Concern | Decision |
|---|---|
| Multi-source cross-check | Requires ≥2 sources. Consensus = arithmetic mean. Rejects if divergence > `maxDivergenceBps` |
| Source unavailability | If all sources fail → skip publication. Never publish a stale/guessed rate |
| Single-source fallback | If only 1 source responds → skip (cannot cross-check) |
| Staleness guard | Relay refuses to publish rates older than `maxStalenessSeconds` (mirrors oracle contract's own guard) |
| Rate limiting | Per-pair: at most 1 publication per `pollIntervalMs` cycle |
| Relay account | Separately permissioned `Feeder` role — not a protocol admin key |

---

## Supported currencies

NGN, KES, GHS, ZAR, TZS, UGX, XOF, EGP (configurable via `FX_CURRENCIES`)

---

## Configuration

| Env var | Default | Description |
|---|---|---|
| `FX_CURRENCIES` | `NGN,KES,GHS,ZAR,TZS,UGX,XOF,EGP` | Comma-separated currencies to track |
| `FX_QUOTE_CURRENCY` | `USDC` | Settlement stablecoin |
| `FX_MAX_DIVERGENCE_BPS` | `200` | Max source divergence before rejection |
| `FX_POLL_INTERVAL_MS` | `300000` | Ingestion cycle interval (5 min) |
| `ORACLE_CONTRACT_ADDRESS` | _(required)_ | price_oracle contract address |
| `FX_RELAY_SECRET` | _(required)_ | Relay account secret key |
| `EXCHANGE_RATE_API_KEY` | _(required)_ | exchangerate-api.com API key |
| `CURRENCY_API_KEY` | _(required)_ | currencyapi.com API key |
| `FX_MAX_STALENESS_SECONDS` | `3600` | Max rate age before staleness rejection |

---

## Running

```bash
npm install
npm run build
FX_RELAY_SECRET=S... ORACLE_CONTRACT_ADDRESS=C... npm start
```

## Testing

```bash
npm test
```

Minimum 90% coverage enforced. All HTTP calls are mockable via the `FxSource` interface.
