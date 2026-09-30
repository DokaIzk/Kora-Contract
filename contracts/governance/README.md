# Governance Contract

Fast-track security governance mechanism for Kora Protocol.

## Overview

The governance contract provides two proposal paths:

### Standard Proposals
- **Use Case:** Routine parameter changes, non-urgent upgrades
- **Approval Threshold:** 50% (5000 bps)
- **Voting Duration:** 24 hours
- **Timelock Delay:** 24 hours after approval

### Fast-Track Security Proposals
- **Use Case:** Critical security fixes from confirmed bug bounty reports
- **Approval Threshold:** 75% (7500 bps) - higher than standard
- **Voting Duration:** 6 hours - faster than standard
- **Timelock Delay:** 6 hours after approval
- **Requirements:**
  - Must link to confirmed bug bounty report (Critical or High severity)
  - Size limited to 1KB to prevent bundling unrelated changes
  - Mandatory post-hoc public disclosure before execution
  - All usage logged on-chain for transparency

## Integration with Bug Bounty Process

Fast-track proposals integrate with the bug bounty triage workflow:

```
1. Security vulnerability reported → BUG_BOUNTY_OPERATIONS.md
2. Triage confirms Critical/High severity
3. Admin calls confirm_bug_bounty_report(report_id, severity)
4. Security fix developed and tested
5. Proposer creates fast-track proposal linked to confirmed report
6. Voting proceeds (75% threshold, 6h window)
7. Admin logs mandatory disclosure
8. Proposal executes after 6h timelock
9. Protocol unpaused, public disclosure published
```

## API

### Initialization

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    access_control: Address,
    min_stake: i128,
    quorum: i128,
    threshold_bps: u32,     // Standard proposals (default: 5000 = 50%)
    voting_duration: u64,   // Standard proposals (default: 86400 = 24h)
) -> Result<(), GovernanceError>
```

Fast-track defaults are set automatically:
- `fast_track_threshold_bps`: 7500 (75%)
- `fast_track_timelock_delay`: 21600 seconds (6 hours)
- `fast_track_max_size_bytes`: 1024 bytes (1 KB)

### Bug Bounty Report Confirmation

```rust
pub fn confirm_bug_bounty_report(
    env: Env,
    admin: Address,
    report_id: BytesN<32>,
    severity: SecuritySeverity,  // Critical or High
) -> Result<(), GovernanceError>
```

Only admin can confirm reports. This creates an auditable on-chain record linking the governance proposal to the security issue.

### Creating Fast-Track Proposals

```rust
pub fn create_fast_track_proposal(
    env: Env,
    proposer: Address,
    target_contract: Address,
    action_hash: BytesN<32>,
    action_size_bytes: u32,        // Must be <= 1024
    bug_report_id: BytesN<32>,     // Must reference confirmed report
) -> Result<u64, GovernanceError>  // Returns proposal_id
```

**Validation:**
- Bug report must be pre-confirmed via `confirm_bug_bounty_report`
- Action size must not exceed `fast_track_max_size_bytes` (prevents bundling)
- Proposer must meet minimum stake requirement
- Automatically logs fast-track usage to `FastTrackUsageLog`

### Voting

```rust
pub fn vote(
    env: Env,
    voter: Address,
    proposal_id: u64,
    support: bool,
) -> Result<(), GovernanceError>
```

Same function for both standard and fast-track proposals. Fast-track proposals automatically apply the higher 75% threshold during execution.

### Disclosure Logging (Fast-Track Only)

```rust
pub fn log_fast_track_disclosure(
    env: Env,
    admin: Address,
    proposal_id: u64,
) -> Result<(), GovernanceError>
```

**Required before execution.** Admin must call this after publishing the public security advisory. Ensures community transparency.

### Execution

```rust
pub fn execute_proposal(
    env: Env,
    proposal_id: u64,
) -> Result<(), GovernanceError>
```

Validates:
- Voting threshold met (50% for standard, 75% for fast-track)
- Timelock elapsed (24h for standard, 6h for fast-track)
- For fast-track: disclosure must be logged
- Target contract hasn't been modified by another mechanism

### Querying

```rust
pub fn get_proposal(env: Env, proposal_id: u64) 
    -> Result<GovProposal, GovernanceError>

pub fn get_fast_track_config(env: Env) 
    -> (u32, u64, u32)  // (threshold_bps, timelock_delay, max_size)
```

## Error Handling

| Error | Meaning |
|-------|---------|
| `NotFastTrackEligible` | Attempted fast-track operation on standard proposal |
| `FastTrackThresholdNotMet` | Less than 75% approval for fast-track proposal |
| `FastTrackSizeExceeded` | Action size exceeds 1KB limit |
| `BugBountyReportNotConfirmed` | Referenced report not found or not confirmed |
| `InvalidSeverityForFastTrack` | Report severity not Critical or High |
| `MandatoryDisclosureNotLogged` | Attempted execution before disclosure logged |

## Security Considerations

### Prevention of Abuse

1. **Pre-confirmed Reports:** Fast-track requires linking to a confirmed bug bounty report, preventing arbitrary "emergency" claims

2. **Size Constraint:** 1KB limit prevents bundling unrelated changes under "security pretext"

3. **Higher Threshold:** 75% approval (vs. 50% standard) requires broader consensus

4. **Mandatory Disclosure:** On-chain disclosure logging provides transparency and accountability

5. **Audit Trail:** All fast-track usage logged with timestamps for community review

### Threat Model

**Threat:** Malicious admin abuses fast-track to push unauthorized changes

**Mitigations:**
- Admin cannot execute directly; requires 75% multisig approval
- Size limit prevents large-scale changes
- Disclosure requirement makes abuse visible
- All usage logged on-chain

**Threat:** "Security theater" - claiming security urgency for non-security changes

**Mitigations:**
- Must link to confirmed bug bounty report with Critical/High severity
- Size constraint limits scope to targeted fixes
- Community can review logged fast-track usage

**Threat:** Legitimate security fix delayed by governance overhead

**Mitigations:**
- Fast-track path reduces 24h to 6h while maintaining multi-party approval
- Protocol pause mechanism provides immediate containment during voting window
- Emergency pause documented in INCIDENT_RESPONSE.md

## Testing

Run governance tests:

```bash
cargo test --package kora-governance
```

Minimum coverage target: 90%

### Test Coverage

- ✅ Standard proposal creation and execution
- ✅ Fast-track proposal creation with confirmed report
- ✅ Fast-track size constraint enforcement
- ✅ Higher threshold requirement (75% vs 50%)
- ✅ Mandatory disclosure requirement
- ✅ Voting on fast-track proposals
- ✅ Fast-track usage logging
- ✅ Error cases (unconfirmed reports, missing disclosure, size exceeded)

## Documentation

- **User Guide:** `docs/governance.md`
- **Incident Response:** `docs/INCIDENT_RESPONSE.md`
- **Bug Bounty Process:** `docs/BUG_BOUNTY_OPERATIONS.md`
- **Threat Model:** `docs/SECURITY.md`

## Future Enhancements

- **Graduated timelock:** Severity-based delays (2h for Critical, 4h for High, 6h for Medium)
- **Automatic disclosure verification:** On-chain proof that public advisory was published
- **Multi-step fast-track:** Separate approval stages for additional accountability
- **Metrics dashboard:** Community-visible fast-track usage statistics
