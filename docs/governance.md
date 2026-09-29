# Protocol-Parameter Governance

Protocol-wide tunable parameters are changed through a lightweight on-chain governance process
rather than by a unilateral single-admin call. The process reuses two existing primitives:

- **B2 multisig** — proposing, voting, and executing are all gated by the configured multisig
  signer set (`configure_multisig`).
- **B1 timelock** — an executed proposal must clear a cooling-off period
  (`GOVERNANCE_TIMELOCK_DELAY`, ~24h, mirroring the upgrade timelock) before it takes effect.

## Governed parameters

| `ParameterKey`   | Meaning                                  | Allowed range |
|------------------|------------------------------------------|---------------|
| `FeeBps`         | Protocol fee in basis points             | `0..=10_000`  |
| `LatePenaltyBps` | Late-repayment penalty in basis points   | `0..=10_000`  |
| `MaxRiskScore`   | Ceiling for accepted invoice risk scores | `0..=100`     |

## Flow

```
propose_parameter_change ──▶ vote_parameter_change ──▶ execute_parameter_change
   (signer; auto-votes)        (other signers)            (quorum + timelock)
```

1. **`propose_parameter_change(proposer, key, new_value)`** — a multisig signer proposes a new
   value. The value is range-checked and the proposer's vote is recorded automatically. Returns a
   `proposal_id`.
2. **`vote_parameter_change(signer, proposal_id)`** — other signers vote in favour. Each signer
   may vote once; already-executed proposals are rejected.
3. **`execute_parameter_change(caller, proposal_id)`** — once approvals reach the multisig
   `threshold` **and** `created_at + GOVERNANCE_TIMELOCK_DELAY` has elapsed, the new value is
   committed on-chain under `Parameter(key)`.

## Reading values

- `get_parameter(key) -> Option<u32>` — the current governed value (or `None` if never set).
- `get_parameter_proposal(proposal_id) -> ParameterProposal` — inspect a proposal's votes/state.

## Errors

| Error | Cause |
|-------|-------|
| `NotMultisigSigner` / `SignerNotFound` | caller is not in the signer set |
| `InvalidParameterValue` | proposed value is out of range |
| `ParameterProposalNotFound` | unknown proposal id |
| `ParameterProposalAlreadyExecuted` | proposal already executed |
| `AlreadyVoted` | signer already voted on this proposal |
| `GovernanceThresholdNotMet` | not enough approvals to execute |
| `GovernanceTimelockNotElapsed` | timelock has not yet elapsed |

The signer set and threshold are intentionally reused from the B2 multisig so governance starts
gated by the same trusted set, leaving room to widen stakeholder participation later.

## Impact Simulation Service

`services/governance-sandbox` exposes `simulateImpact(change, snapshot)` for
proposal previews. Its concentration-cap plugin reports listings over the new
cap and investors within the configured proximity band. Its fee-tier plugin
reports affected listings and the estimated fee delta using funded amounts.
Unrecognized parameter types return a generic before/after diff. Every result
includes the source snapshot timestamp and is explicitly a current-state
estimate, not a guarantee of execution impact. The service receives snapshots
through an adapter so deployments can source indexed protocol state.

## Signature-Based Off-Chain Voting

`services/offchain-voting` provides Stellar Ed25519 vote verification, stake
weight lookup through the same governance source adapter used for on-chain
eligibility, proposal-scoped signatures, and deterministic SHA-256 tally
summaries for on-chain anchoring. Proposal IDs are included in the signed
message, so a signature cannot be replayed for another proposal. The adapter
must refuse off-chain voting whenever on-chain voting is open and must verify
the proposal is designated for the off-chain path. Its repository adapter must
provide atomic mode reservation and vote insertion in persistent storage; the
included in-memory store is for tests/development only. Result anchoring and
optional execution are idempotent on-chain adapter operations and must apply the
governance contract's quorum and threshold rules. The contract defaults each
proposal to on-chain voting; an authenticated admin may designate off-chain
voting before any on-chain votes are cast. On-chain voting is then rejected.
After the voting deadline, the admin-authenticated adapter may anchor one tally
hash and its `for`/`against` weights. Execution uses those anchored weights with
the same quorum and approval threshold as on-chain voting. The hash is publicly
readable through `get_offchain_result`; the authorized anchor adapter is
responsible for deriving it from the canonical tally.
