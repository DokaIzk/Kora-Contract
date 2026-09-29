# Kora Protocol — Governance System

Comprehensive documentation for the Kora Protocol governance system, including on-chain voting, delegation, treasury transparency, and community engagement.

## Table of Contents

1. [Overview](#overview)
2. [Governance Contract](#governance-contract)
3. [Vote Delegation](#vote-delegation)
4. [Quadratic Voting](#quadratic-voting)
5. [Treasury Dashboard](#treasury-dashboard)
6. [Forum Integration](#forum-integration)
7. [Governance Process](#governance-process)
8. [Security & Auditing](#security--auditing)

## Overview

The Kora governance system enables stakeholders to participate in protocol decision-making through:

- **On-chain voting** with flexible delegation
- **Quadratic voting** for community sentiment proposals
- **Transparent treasury** management with public visibility
- **Forum integration** for proposal discussion

### Design Principles

1. **Accessibility**: Small stakeholders can delegate to trusted representatives
2. **Flexibility**: Different voting modes for different proposal types
3. **Transparency**: All treasury activity publicly verifiable on-chain
4. **Community-driven**: Open discussion before voting

## Governance Contract

Location: `contracts/governance_voting/`

### Proposal Types

| Type | Description | Voting Mode | Example |
|------|-------------|-------------|---------|
| **Financial** | Treasury allocation, grants | Standard only | "Allocate 100k USDC to marketing" |
| **Sentiment** | Community preference | Standard or Quadratic | "Should we support network X?" |
| **Upgrade** | Protocol upgrades | Standard only | "Upgrade contract to v2.0" |
| **ParameterChange** | Config updates | Standard | "Change fee from 50 to 30 bps" |

### Voting Modes

#### Standard Voting

- Direct stake-weighted voting
- 1 token staked = 1 vote
- Used for all financial decisions
- Simple and predictable

#### Quadratic Voting

- Vote cost scales quadratically
- Votes = √(voice_credits_spent)
- Better represents broad community preference
- Only for sentiment proposals (not financial)

**Rationale**: Financial proposals affect real capital allocation and should be weighted by actual stake. Sentiment proposals gauge community direction and benefit from quadratic voting's resistance to plutocracy.

### Proposal Lifecycle

```
1. CREATED
   ├─ Proposer creates proposal
   ├─ Forum thread auto-created
   └─ Voting period begins (default: 7 days)
   
2. VOTING
   ├─ Stakeholders vote directly or via delegation
   ├─ Forum discussion ongoing
   └─ Vote tallies updated in forum
   
3. QUORUM CHECK
   ├─ Total votes ≥ quorum_required?
   ├─ Yes: Eligible for execution
   └─ No: Proposal fails
   
4. EXECUTION (admin-triggered)
   ├─ Quorum met + not expired
   ├─ Admin executes on-chain action
   └─ Forum thread updated with outcome
   
5. COMPLETE
   └─ Result recorded on-chain and forum
```

## Vote Delegation

### How It Works

1. **Delegate**: Alice has 1000 tokens staked but no time to evaluate proposals
2. **Choose representative**: Alice delegates to Bob, a trusted community member
3. **Bob votes**: Bob's voting weight = his stake + Alice's stake
4. **Alice retains ownership**: Alice still owns her 1000 tokens, can trade/unstake
5. **Revocable**: Alice can revoke delegation anytime, even mid-vote

### Key Features

- **Single-level only**: No transitive chains (A→B→C not allowed)
- **Direct vote precedence**: If Alice votes directly, her delegation is ignored for that proposal
- **Circular prevention**: A→B→A automatically rejected
- **Instant effect**: Delegation/revocation applies immediately

### Use Cases

1. **Time-constrained holders**: Professionals who can't follow every proposal
2. **Expertise delegation**: Technical proposals delegated to developers
3. **Community representatives**: Active members accumulate trust and voting power
4. **Geographic representation**: Delegates in different time zones

### Example Flow

```rust
// Alice delegates to Bob
governance.delegate(&alice, &bob);

// Bob creates a proposal
let proposal_id = governance.create_proposal(
    &bob,
    &"Proposal Title",
    &"Description...",
    &ProposalType::Sentiment,
    &VotingMode::Quadratic,
    &1000, // quorum
    &0,    // default 7 days
);

// Bob votes (using his weight + Alice's delegated weight)
governance.vote(&bob, &proposal_id, &VoteChoice::For, &49);

// Alice can revoke and vote directly anytime
governance.revoke_delegation(&alice);
governance.vote(&alice, &proposal_id, &VoteChoice::Against, &0);
// Alice's direct vote now counts, Bob only has his own weight
```

## Quadratic Voting

### Mathematical Model

**Voice Credits to Votes Conversion:**

```
votes = floor(√voice_credits)
```

| Voice Credits | Votes | Marginal Cost |
|---------------|-------|---------------|
| 1 | 1 | 1 |
| 4 | 2 | 3 |
| 9 | 3 | 5 |
| 16 | 4 | 7 |
| 25 | 5 | 9 |
| 36 | 6 | 11 |
| 49 | 7 | 13 |
| 64 | 8 | 15 |
| 81 | 9 | 17 |
| 100 | 10 | 19 |

**Key Property**: Each additional vote costs more than the last, making it expensive for whales to dominate while allowing small holders to express strong preferences.

### Integer Square Root Algorithm

```rust
fn integer_sqrt(n: i128) -> i128 {
    if n <= 1 { return n; }
    
    let mut low = 1;
    let mut high = n;
    let mut result = 1;
    
    while low <= high {
        let mid = low + (high - low) / 2;
        let square = mid.saturating_mul(mid);
        
        if square == n {
            return mid;
        } else if square < n {
            low = mid + 1;
            result = mid;
        } else {
            high = mid - 1;
        }
    }
    
    result
}
```

No floating-point math ensures deterministic, consensus-safe results.

### When to Use

✅ **Good for:**
- Community preference polls
- Protocol direction decisions
- Non-financial governance questions
- Measuring sentiment intensity

❌ **Not for:**
- Treasury fund allocation
- Grant distributions
- Contract upgrades affecting security
- Any decision with direct financial impact

### Sybil Resistance Limitations

**Known Issue**: An actor with 100 tokens can achieve more votes by splitting across multiple addresses:

- 1 address with 100 tokens: √100 = 10 votes
- 100 addresses with 1 token each: 100 × √1 = 100 votes

**Mitigation Strategies:**

1. **Proposal Type Restriction**: Quadratic voting only for sentiment (non-financial)
2. **Documentation**: Clearly state this limitation
3. **Community Vigilance**: Monitor for suspicious voting patterns
4. **Future Enhancement**: Identity verification / KYB for quadratic proposals

**Why This Is Acceptable**: Sentiment proposals don't allocate real capital, so gaming the vote affects opinion polling rather than fund distribution. For financial proposals, standard stake-weighted voting prevents this attack.

## Treasury Dashboard

### Overview

Public read-only dashboard providing full transparency into treasury activity.

**URL**: `https://governance.kora.finance/treasury` (example)

### Features

#### 1. Real-Time Balances

Display current treasury holdings across all supported assets:

```
┌─────────────────────────────────────┐
│ Treasury Balances (Live)            │
├─────────────────────────────────────┤
│ USDC:  $1,234,567.89                │
│ XLM:   456,789 XLM ($123,456)       │
│ EURC:  €987,654.32                  │
│                                      │
│ Total Value: ~$2.3M USD             │
└─────────────────────────────────────┘
```

Each balance links to on-chain token contract for verification.

#### 2. Fee Sweep History

Chronological log of all fee collections:

| Date | Source | Asset | Amount | Tx Hash |
|------|--------|-------|--------|---------|
| 2026-09-28 | Marketplace | USDC | +1,234.56 | [0xabc...] |
| 2026-09-27 | Financing Pool | XLM | +5,678 | [0xdef...] |
| 2026-09-26 | Secondary Market | EURC | +987.65 | [0x123...] |

Clicking tx hash opens block explorer for independent verification.

#### 3. Grant Disbursements

All outgoing treasury grants with governance proposal links:

| Date | Recipient | Purpose | Amount | Proposal | Status |
|------|-----------|---------|--------|----------|--------|
| 2026-09-25 | 0x789... | Marketing | 50,000 USDC | [#42] | Executed |
| 2026-09-20 | 0xabc... | Development | 100,000 XLM | [#38] | Executed |

Each proposal link goes to forum discussion thread.

#### 4. Governance Outcomes

Visual summary of proposals affecting treasury:

```
Proposal #42: Marketing Grant
├─ Type: Financial
├─ Requested: 50,000 USDC
├─ Votes: 1.2M For / 300K Against
├─ Outcome: ✅ Passed & Executed
├─ Tx: 0x123abc...
└─ Forum: [discussion link]
```

### Architecture

```
┌─────────────────┐
│ Analytics       │
│ Service         │◄───── Indexes on-chain events
│ (services/      │
│  analytics/)    │
└────────┬────────┘
         │
         │ REST API
         ▼
┌─────────────────┐
│ Public          │
│ Dashboard       │◄───── Users browse
│ (apps/web/)     │       (no login required)
└─────────────────┘
```

**Data Flow:**

1. **Indexer** watches treasury contract events
2. **Analytics service** aggregates events into metrics
3. **Public API** serves read-only data
4. **Dashboard** renders with on-chain verification links

### Implementation Notes

**Multi-Asset Display:**
- Never conflate different assets into single "total"
- Display each asset's balance separately
- Optional: show USD-equivalent if price oracle available
- Clearly label estimates vs. on-chain balances

**Verification Links:**
- Every displayed figure must link to source transaction
- Block explorer links for all operations
- Contract state queries link to RPC endpoint response

**Live Updates:**
- WebSocket or polling for real-time updates
- Event stream from indexer to dashboard
- Cache with short TTL (e.g., 30 seconds)

## Forum Integration

Location: `services/governance-sync/`

### Bidirectional Flow

```
On-Chain Proposal Created
         │
         ├─ Sync Service detects new proposal
         │
         ├─ Creates forum thread with:
         │  ├─ Proposal details
         │  ├─ Voting mode & quorum
         │  └─ Links to on-chain proposal
         │
         ├─ Community discusses in thread
         │
         ├─ Periodic updates with vote tallies
         │
         └─ Final outcome posted when executed
```

### Forum Thread Format

**Initial Post:**

```markdown
# [Proposal #42] Allocate Marketing Budget

**Type:** Financial  
**Voting Mode:** Standard  
**Proposer:** `GBXXX...ABC`  
**Expires:** 2026-10-05 12:00 UTC  
**Quorum Required:** 1,000,000

---

## Description

[Full proposal description from on-chain data]

---

## Current Vote Tally

- ✅ For: 0
- ❌ Against: 0
- ⚪ Abstain: 0

**Total Votes:** 0 / 1,000,000 (0.0% of quorum)

*This thread is automatically synced with on-chain Proposal #42.*

[Vote On-Chain] [View Contract State]
```

**Tally Update Posts:**

```markdown
**Vote Tally Update**

**Status:** 🗳️ Voting in progress

- ✅ For: 1,234,567
- ❌ Against: 345,678
- ⚪ Abstain: 12,345

**Total Votes:** 1,592,590 / 1,000,000 (159.3% of quorum)

*Updated: 2026-10-03 18:45 UTC*
```

### Sync Service Features

1. **Idempotent Sync**: Keyed by proposal ID, won't create duplicate threads
2. **Retry Logic**: Exponential backoff on forum API failures
3. **Rate Limiting**: Respects forum platform rate limits
4. **Failure Recovery**: Logs failed syncs, retries on next poll

### Database Schema

```sql
CREATE TABLE sync_records (
    proposal_id INTEGER PRIMARY KEY,
    forum_thread_id TEXT NOT NULL,
    synced_at INTEGER NOT NULL,
    last_update INTEGER NOT NULL
);
```

Tracks which proposals have been synced and when last updated.

## Governance Process

### For Proposers

1. **Draft Proposal**: Write clear title and detailed description
2. **Choose Type**: Financial, Sentiment, Upgrade, or ParameterChange
3. **Select Voting Mode**: Standard for most; Quadratic for sentiment only
4. **Set Quorum**: Minimum votes needed (typically 5-10% of total stake)
5. **Submit On-Chain**: Call `create_proposal()` (costs gas)
6. **Monitor Forum**: Engage with community discussion
7. **Iterate if Needed**: Can create amended proposal if feedback requires changes

### For Voters

1. **Review Proposal**: Read on-chain data and forum discussion
2. **Evaluate**: Consider merits, financials, community feedback
3. **Decide**: For, Against, or Abstain
4. **Vote On-Chain**: Direct vote or ensure delegate represents your view
5. **Track Outcome**: Monitor vote tallies and final result

### For Delegates

1. **Accept Delegation**: Publicly announce willingness to represent others
2. **Stay Informed**: Follow all active proposals closely
3. **Communicate**: Post voting rationale in forum threads
4. **Vote Responsibly**: Vote on behalf of all delegators
5. **Maintain Trust**: Consistent, reasoned participation

## Security & Auditing

### Smart Contract Security

1. **Authorization**: All mutations require `require_auth()`
2. **Overflow Protection**: Checked arithmetic throughout
3. **Delegation Safety**: Circular delegation prevented
4. **Vote Finality**: Cannot change vote once cast
5. **Quorum Enforcement**: Cannot execute without meeting threshold

### Audit Trail

Every governance action recorded on-chain:

- Proposal creation: `ProposalCreated` event
- Votes cast: `VoteCast` event with voter, choice, weight
- Delegations: `DelegationUpdated` event
- Executions: `ProposalExecuted` event

All events queryable via RPC for independent verification.

### Treasury Security

1. **Multi-sig Gating**: High-value operations require multisig approval
2. **Rate Limiting**: Withdrawal caps per 24h period
3. **Whitelist**: Only approved tokens can be withdrawn
4. **Emergency Procedures**: Declared emergency required for unlimited withdrawal
5. **Audit Log**: On-chain hash-chained audit log of all admin actions

### Forum Integration Security

1. **Read-Only Sync**: Forum cannot trigger on-chain actions
2. **API Key Management**: Forum credentials in environment variables
3. **No PII**: Forum threads contain no private user data
4. **Rate Limiting**: Respects forum platform limits
5. **Retry Safety**: Idempotent operations prevent double-posting

## Testing

### Contract Tests

```bash
cd contracts/governance_voting
cargo test --lib
```

**Coverage Target:** 90%+

Test suites:
- Delegation (precedence, revocation, circular prevention, fan-in)
- Quadratic voting (cost calculation, validation, integer sqrt)
- Proposal lifecycle (creation, voting, execution, expiry)
- Vote tallying (standard, quadratic, mixed)

### Service Tests

```bash
cd services/governance-sync
npm test
```

Test coverage:
- Idempotent thread creation
- Retry on API failure
- Tally freshness within bounds
- Database sync record management

## Deployment

### Prerequisites

1. Deploy `access_control` contract
2. Deploy `governance_voting` contract
3. Configure staking/weight source
4. Set up indexer for event watching
5. Deploy analytics service
6. Deploy governance-sync service
7. Launch public dashboard

### Configuration

**On-Chain:**

```rust
// Initialize governance contract
governance.initialize(
    &admin_address,
    &access_control_address,
);

// Set voting weights (sync from staking contract)
for (address, stake) in staking.get_all_stakes() {
    governance.set_voting_weight(&admin, &address, &stake);
}
```

**Off-Chain:**

```bash
# Analytics service
SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
GOVERNANCE_CONTRACT_ID=CXXXX...
DATABASE_URL=postgresql://...

# Governance-sync service
FORUM_API_URL=https://forum.kora.finance/api
FORUM_API_KEY=xxx
POLL_INTERVAL_MS=60000
```

## Future Enhancements

1. **Multi-level Delegation**: Transitive delegation with cycle detection
2. **Vote Escrow**: Time-locked stakes receive boosted voting weight
3. **Snapshot Voting**: Prevent flash-loan attacks via historical snapshots
4. **Conviction Voting**: Vote weight increases the longer you commit
5. **Ranked Choice**: Voters rank multiple options
6. **Shielded Voting**: Private votes until proposal expires

## Resources

- **Contract Code**: [`contracts/governance_voting/`](./contracts/governance_voting/)
- **Sync Service**: [`services/governance-sync/`](./services/governance-sync/)
- **Treasury Dashboard**: [`apps/web/treasury/`](./apps/web/treasury/) *(placeholder)*
- **Forum**: https://forum.kora.finance *(example)*

## License

MIT
