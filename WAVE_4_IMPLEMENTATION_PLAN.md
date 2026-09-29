# Wave 4 Implementation Plan

## Overview
This document outlines the implementation of four high-complexity governance and infrastructure features for the Kora Protocol.

## Activity 1: Vesting Contract (200 points)

### Objective
Build a vesting contract managing time-based unlock schedules for governance-relevant stake/tokens with cliff and linear-vesting terms.

### Key Requirements
- Configurable per-grant cliff period and linear-vesting schedule
- Unvested amounts are neither transferable nor countable toward governance voting weight
- Support for grant revocation (forfeit unvested remainder only)
- Integration with governance contract for weight calculation

### Implementation Plan
**Files to Create:**
- `contracts/vesting/Cargo.toml`
- `contracts/vesting/src/lib.rs`
- `docs/vesting.md`

**Key Components:**
1. **VestingSchedule struct**: cliff_duration, total_duration, total_amount, start_time
2. **Grant tracking**: Per-beneficiary grant records
3. **Vesting calculation**: Time-based linear vesting after cliff
4. **Revocation logic**: Forfeit unvested, preserve vested
5. **Governance integration**: `get_vested_balance()` for weight calculation

**Testing Requirements:**
- Minimum 90% coverage
- Test vested vs unvested governance weight exclusion
- Test revocation forfeits only unvested amounts
- Test cliff/final-vest boundary precision

---

## Activity 2: Community Node Infrastructure Documentation (200 points)

### Objective
Enable community members to run independent Soroban/Stellar infrastructure (RPC node, indexer) to strengthen decentralization.

### Key Requirements
- Clear documentation for standing up independent indexer instance
- Cross-verification tooling against canonical instance
- Resource requirements documented
- Validated by independent stand-up attempt

### Implementation Plan
**Files to Create:**
- `docs/RUNNING_A_NODE.md`
- `tools/verify-indexer.sh` (cross-verification script)
- `docker-compose.community-node.yml` (optional deployment template)

**Key Sections in Documentation:**
1. **Prerequisites**: Hardware, software, network requirements
2. **Setup Steps**: Clone, configure, deploy indexer
3. **Configuration**: RPC endpoints, database setup
4. **Verification**: Compare output with canonical instance
5. **Monitoring**: Health checks, common issues
6. **Maintenance**: Updates, backup strategies

**Tooling:**
- Script to compare indexer outputs (reuse reconciliation-service logic)
- Docker compose for simplified deployment
- Health check endpoints

---

## Activity 3: Fast-Track Governance for Critical Security Fixes (200 points)

### Objective
Build fast-track governance path for time-sensitive security fixes with meaningful multi-party sign-off.

### Key Requirements
- Distinct fast-track proposal category for critical security fixes only
- Higher multi-sig threshold than routine actions
- Much shorter (but non-zero) timelock than standard governance
- Mandatory public post-hoc disclosure and community review
- Strictly scoped to confirmed critical security fixes

### Implementation Plan
**Files to Modify:**
- `contracts/governance/src/lib.rs`
- `docs/governance.md`
- `docs/INCIDENT_RESPONSE.md`

**Key Components:**
1. **FastTrackProposal struct**: Linked to bug-bounty report ID, emergency flag
2. **Eligibility gating**: Require bug-bounty critical severity confirmation
3. **Higher threshold**: e.g., 3/5 vs 2/5 for routine
4. **Reduced timelock**: e.g., 2h vs 24h
5. **Mandatory disclosure**: Automatic event logging, post-hoc report requirement
6. **Size constraints**: Limit proposal scope (lines of code, file count)

**Testing Requirements:**
- Minimum 90% coverage
- Test fast-track eligibility gating
- Test higher-threshold enforcement
- Test mandatory disclosure triggering

---

## Activity 4: Wave Contributor Dashboard (200 points)

### Objective
Public dashboard tracking Wave contributor initiatives with visibility into work allocation and payouts.

### Key Requirements
- List Wave issues, complexity/point value, claiming contributor
- Merge status and payout/disbursement status
- Link to on-chain treasury-grant disbursement records
- Cross-reference GitHub data with blockchain records

### Implementation Plan
**Files to Create:**
- `apps/web/src/components/wave-dashboard/` (new directory)
- `apps/web/src/components/wave-dashboard/ContributorDashboard.tsx`
- `apps/web/src/components/wave-dashboard/IssueCard.tsx`
- `apps/web/src/components/wave-dashboard/PayoutStatus.tsx`
- `apps/web/src/services/waveService.ts`
- `apps/web/src/types/wave.ts`

**Key Components:**
1. **GitHub Data Integration**: Fetch issues with Wave labels, PRs, merge status
2. **Blockchain Data Integration**: Query treasury contract for disbursements
3. **Linking**: Match issue numbers to on-chain grant proposals
4. **Status Tracking**: 
   - Issue claimed/unclaimed
   - PR open/merged
   - Payout pending/completed/declined
5. **Filters and Search**: By contributor, status, complexity

**Data Model:**
```typescript
interface WaveIssue {
  id: number;
  title: string;
  url: string;
  complexity: number; // points
  status: 'open' | 'claimed' | 'in-progress' | 'merged' | 'paid';
  contributor: string | null;
  claimedAt: Date | null;
  mergedAt: Date | null;
  payoutStatus: 'none' | 'pending' | 'approved' | 'paid' | 'declined';
  payoutTxHash: string | null;
  payoutAmount: string | null;
}
```

**Testing Requirements:**
- Minimum 90% coverage
- Test cross-referencing accuracy
- Test stale-claim handling
- Test payout-status-state correctness

---

## Implementation Sequence

### Phase 1: Core Contracts (Week 1-2)
1. Vesting contract implementation
2. Fast-track governance additions
3. Contract testing

### Phase 2: Infrastructure & Documentation (Week 2-3)
4. Node running documentation
5. Verification tooling
6. Independent validation

### Phase 3: Frontend & Integration (Week 3-4)
7. Wave dashboard implementation
8. GitHub/blockchain integration
9. End-to-end testing

### Phase 4: Documentation & Review (Week 4)
10. Complete all documentation
11. Code review
12. CI/CD integration

---

## Success Criteria

### Activity 1 (Vesting)
✅ Contract written, tested, documented  
✅ 90%+ test coverage  
✅ Governance integration verified  
✅ PR passes CI  

### Activity 2 (Node Infrastructure)
✅ Documentation complete  
✅ Verification tooling working  
✅ Independent stand-up validated  
✅ Resource requirements documented  

### Activity 3 (Fast-Track Governance)
✅ Mechanism written, tested, documented  
✅ 90%+ test coverage  
✅ Eligibility gating works  
✅ PR passes CI  

### Activity 4 (Wave Dashboard)
✅ Dashboard written, tested, documented  
✅ 90%+ test coverage  
✅ Cross-referencing accurate  
✅ Screenshots included  

---

## Risk Mitigation

### Technical Risks
- **Vesting calculation edge cases**: Extensive boundary testing
- **Fast-track abuse**: Strict eligibility gating + audit trail
- **Dashboard data sync**: Graceful error handling, caching strategy
- **Node setup complexity**: Step-by-step validation, Docker simplification

### Security Considerations
- Vesting revocation must never claw back vested amounts
- Fast-track must not bypass security for convenience
- Dashboard must not expose sensitive contributor data
- Node verification must detect tampering

---

## Dependencies

### External
- GitHub API (Wave dashboard)
- Soroban RPC (indexer, dashboard)
- Bug bounty system (fast-track eligibility)

### Internal
- `contracts/governance` (vesting integration, fast-track)
- `contracts/treasury` (wave dashboard payouts)
- `contracts/access_control` (fast-track multi-sig)
- `services/indexer` (node documentation)
