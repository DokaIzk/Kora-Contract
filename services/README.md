# Kora Protocol — Off-Chain Services

This directory contains the off-chain backend services that complement the on-chain Soroban contracts.

| Service | Issue | Description |
|---|---|---|
| [`keeper/`](keeper/) | [#765](https://github.com/Creed1759/Kora-Contract/issues/765) | Background job queue for deadline-based contract triggers |
| [`fx-ingestion/`](fx-ingestion/) | [#766](https://github.com/Creed1759/Kora-Contract/issues/766) | FX rate ingestion and oracle relay for African currencies |
| [`audit-log/`](audit-log/) | [#768](https://github.com/Creed1759/Kora-Contract/issues/768) | Tamper-evident hash-chained off-chain audit log |
| [`reporting/`](reporting/) | [#770](https://github.com/Creed1759/Kora-Contract/issues/770) | Data export service for regulatory/tax reporting |

All services are TypeScript, independently deployable, and share no runtime dependencies on each other. The `audit-log` service is consumed as a library by the others.

## Quick start

```bash
# From any service directory:
npm install
npm test
npm run build
npm start
```

See each service's own `README.md` for configuration and detailed documentation.
