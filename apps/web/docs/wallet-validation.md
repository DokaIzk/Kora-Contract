# Wallet connection validation — issue #774

## Scope

Freighter + Rabet connection lifecycle, network identity, state persistence,
account switching, disconnect, and subscription cleanup. No signing, live funds,
wallet private keys, or real RPC calls are involved in these tests.

## Reproduce from `apps/web`

```sh
npm test -- --runInBand --runTestsByPath tests/wallet.test.ts tests/wallet-lifecycle.test.ts tests/wallet-ui.test.tsx --coverage --collectCoverageFrom='src/wallet/**/*.ts'
```

```sh
npx --no-install tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --jsx react-jsx --esModuleInterop --skipLibCheck src/wallet/types.ts src/wallet/network.ts src/wallet/adapters.ts src/wallet/manager.ts src/context/WalletContext.tsx src/components/wallet/WalletConnection.tsx
```

## Results (September 30, 2026)

- Focused tests: **113 passed, 0 failed** across three suites.
- Wallet layer: **98.09% statements, 96.11% branches, 100% functions, 99.03% lines**.
- Isolated strict TypeScript check of wallet/context/UI integration: **pass**.
- Lifecycle model: **4,096 four-action sequences / 16,384 transitions** against the actual `WalletManager`, each checked against an independent UI-state and persistence oracle.
- Initial red phase: **26 of 27 newly introduced directed cases failed on the previous PR head `e6eb4ec`**. The fixed candidate passes those cases. These are regression cases, not 26 separate root causes.
- `git diff --check`: **pass**.

The synthetic lab drives production code with fake providers and controlled
Promise completion order. It is not millions of live-wallet operations or a
fleet of independent agents. UI tests render the actual React provider and
component; real extension prompts and browser end-to-end signing remain outside
this mock-based verification.

## Defects addressed by the follow-up

- Friendly names or substrings no longer override an unknown/custom passphrase.
- Cancelled availability checks cannot start an obsolete provider request.
- Local disconnect is immediate; an older disconnect cannot clear a newer session.
- Queued callbacks from an old connection to the same wallet are rejected.
- Provider cleanup errors and monitor startup failures fail closed locally.
- Each state subscriber receives its own snapshot.
- Rabet refresh results cannot overwrite newer account/network events or reuse a stale network on an error.
- Freighter fallback polls do not overlap or publish after cleanup.
- Disconnect failures render a local-session-cleared warning instead of becoming unhandled UI promises.

## Whole-project baseline (not a green full CI claim)

Clean `main` at `d8199b0` and the candidate were run with the same dependencies.
Both produce **55 TypeScript diagnostics / 23 distinct normalized signatures**;
there are **zero new or changed diagnostic signatures**.

Full Jest baseline: **31 passed tests, 1 failed test; 8 passed / 2 failed suites**.
Candidate: **144 passed tests, the same 1 failed test; 11 passed / the same 2 failed suites**.
The unchanged failures are `tests/invoiceWizard.test.ts` (draft storage) and
`tests/wave-dashboard.test.ts` (TypeScript constructability).

These pre-existing failures are not suppressed or rewritten by this PR. The
isolated passing suite does not imply the full project is green. Maintainer
approval of fork Actions and human review are still separate requirements.
