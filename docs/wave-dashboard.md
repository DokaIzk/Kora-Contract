# Wave Contributor Dashboard

The Wave Contributor Dashboard provides public visibility into Wave-style contributor initiatives — issues claimed, PRs merged, points/rewards allocated, and payout status. This transparency builds trust with both contributors and the broader community.

---

## Purpose & Context

A Wave initiative's credibility depends on visible, trustworthy tracking of who did what work and what they were paid for it. Without a dedicated transparent dashboard, this information stays scattered across issue trackers, PRs, and off-chain payment records with no unified, verifiable view.

**Key Principle:** All contributor work and payouts are publicly auditable by cross-referencing GitHub activity with on-chain treasury disbursements.

---

## Architecture

```
GitHub API ──┐
             ├──▶ Wave Service ──▶ Dashboard UI
Indexer API ─┘
```

### Data Sources

1. **GitHub Issues API**
   - Wave-labeled issues
   - Complexity labels (Low/Medium/High)
   - Claim status (assignee)
   - PR references
   - Merge status

2. **On-Chain Indexer**
   - Treasury grant disbursements
   - Transaction hashes
   - Recipient addresses
   - Payout amounts

### Cross-Referencing

Issues are linked to disbursements by **issue number** referenced in the on-chain grant proposal metadata:

```typescript
// GitHub Issue #100 references "Grant Proposal: #1"
// On-chain grant #1 includes { issue_number: 100 }
// Dashboard cross-references to show payout status
```

---

## Dashboard Features

### 1. Issue List

**Displays:**
- Issue number (linked to GitHub)
- Title and description
- Complexity and point value
- Current status (Open/Claimed/In Progress/Completed)
- Claimed by (GitHub username)
- PR number (if merged)
- Payout status (Pending/Approved/Disbursed/Rejected)
- Grant proposal ID (if approved)
- Transaction hash (if disbursed)

**Filtering:**
- By status: Open, Claimed, In Progress, Completed, Abandoned
- By payout status: Pending, Approved, Disbursed, Rejected, Not Eligible

**Sorting:**
- By points, created date, updated date, issue number

### 2. Contributor Leaderboard

**Displays:**
- Rank (with 🥇🥈🥉 for top 3)
- GitHub username (linked)
- Total issues claimed
- Completed issues
- Total points earned
- Points disbursed
- Points pending
- Join date

**Sorting:** By total points (descending)

### 3. Statistics Overview

**Metrics:**
- Total issues
- Open issues
- Claimed/In Progress issues
- Completed issues
- Completion rate
- Active contributors
- Total points allocated
- Total points disbursed
- Disbursement rate

**Visualizations:**
- Issue status breakdown (stacked bar chart)
- Payout breakdown (stacked bar chart)

---

## Point Values

Points are assigned based on issue complexity:

| Complexity | Points |
|------------|--------|
| Low | 50 |
| Medium | 100 |
| High | 200 |

**Future Enhancement:** Points could map to actual payout amounts (e.g., 1 point = $1 USDC), but this is currently a business/community decision outside technical scope.

---

## Issue Status Workflow

```
Open ──▶ Claimed ──▶ In Progress ──▶ Completed
            │                            │
            └─────▶ Abandoned ◀──────────┘
```

| Status | Meaning | GitHub Mapping |
|--------|---------|----------------|
| **Open** | Available to claim | No assignee |
| **Claimed** | Contributor assigned | Has assignee, no `in-progress` label |
| **In Progress** | Work actively underway | Has `in-progress` label |
| **Completed** | PR merged | Issue closed with `completed` label |
| **Abandoned** | Claim dropped | Issue closed with `abandoned` label |

---

## Payout Status Workflow

```
Pending ──▶ Approved ──▶ Disbursed
   │
   └───────▶ Rejected / Not Eligible
```

| Status | Meaning | Criteria |
|--------|---------|----------|
| **Pending** | Work completed, awaiting approval | Issue completed, no payout label |
| **Approved** | Approved for payout | Has `payout-approved` label |
| **Disbursed** | Paid out on-chain | Treasury grant disbursement recorded |
| **Rejected** | Payout declined | Has `payout-rejected` label |
| **Not Eligible** | Work not eligible for payout | Has `not-eligible` label |

---

## Cross-Referencing Logic

### Matching Algorithm

1. **Fetch GitHub issues** with `wave` and `contributor-reward` labels
2. **Fetch on-chain grants** from treasury via indexer
3. **Extract issue numbers** from:
   - GitHub issue body (e.g., "Grant Proposal: #123")
   - On-chain grant metadata (e.g., `{ issue_number: 100 }`)
4. **Match by issue number** to link disbursements to issues
5. **Update payout status** to `Disbursed` if match found

### Handling Edge Cases

#### Stale Claims
**Problem:** Issue claimed but abandoned without explicit label change  
**Solution:** Status remains `Claimed` until:
- Issue closed with `abandoned` label
- Reassigned to different contributor
- Manually marked stale (future enhancement: auto-detect inactivity)

#### Payouts Without GitHub Issue
**Problem:** On-chain grant without corresponding issue  
**Solution:** Indexer returns all grants; dashboard filters to those with `issue_number` metadata

#### Multiple Claims (Reassignment)
**Problem:** Issue reassigned from one contributor to another  
**Solution:** GitHub's `assignee` field always reflects current claimant; previous claimant no longer associated

#### Partial Payouts
**Problem:** Issue partially completed or split payout  
**Solution:** Out of scope — each issue has single point value and single payout status

---

## API Integration

### GitHub API

**Endpoint:** `https://api.github.com/repos/kora-finance/contracts/issues`

**Query Parameters:**
- `labels=wave,contributor-reward`
- `state=all` (include open and closed)
- `per_page=100`

**Rate Limiting:**
- Unauthenticated: 60 requests/hour
- Authenticated: 5000 requests/hour
- Dashboard uses caching and refresh button to manage limits

**Response Structure:**
```json
{
  "number": 100,
  "title": "Build vesting contract",
  "body": "Description\nGrant Proposal: #1",
  "state": "closed",
  "assignee": { "login": "contributor1" },
  "labels": [
    { "name": "wave" },
    { "name": "High" },
    { "name": "completed" }
  ],
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-10T00:00:00Z"
}
```

### Indexer API

**Endpoint:** `https://api.kora.finance/api/v1/treasury/grants`

**Query Parameters:**
- `type=wave-contributor` (filter to Wave grants)

**Response Structure:**
```json
{
  "grants": [
    {
      "proposal_id": 1,
      "recipient": "GABCD...XYZ",
      "amount": 200,
      "token": "USDC",
      "metadata": {
        "issue_number": 100
      },
      "tx_hash": "0x123abc...",
      "timestamp": "2024-01-11T00:00:00Z"
    }
  ]
}
```

---

## Implementation Details

### Service Layer

**File:** `apps/web/src/services/waveService.ts`

**Key Methods:**

| Method | Purpose | Returns |
|--------|---------|---------|
| `fetchWaveIssues()` | Get all Wave issues from GitHub | `WaveIssue[]` |
| `fetchGrantDisbursements()` | Get on-chain disbursements from indexer | `GrantDisbursement[]` |
| `fetchWaveIssuesWithDisbursements()` | Cross-reference issues with disbursements | `WaveIssue[]` |
| `fetchContributors()` | Aggregate contributor statistics | `Contributor[]` |
| `fetchWaveStats()` | Calculate program-wide statistics | `WaveStats` |

### Type Definitions

**File:** `apps/web/src/types/wave.ts`

**Key Types:**

```typescript
enum WaveIssueStatus {
  OPEN = 'open',
  CLAIMED = 'claimed',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

enum PayoutStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DISBURSED = 'disbursed',
  REJECTED = 'rejected',
  NOT_ELIGIBLE = 'not_eligible',
}

interface WaveIssue {
  id: string;
  issueNumber: number;
  title: string;
  complexity: 'Low' | 'Medium' | 'High';
  pointValue: number;
  status: WaveIssueStatus;
  claimedBy?: string;
  payoutStatus: PayoutStatus;
  grantProposalId?: number;
  disbursementTxHash?: string;
}

interface Contributor {
  githubUsername?: string;
  totalIssues: number;
  completedIssues: number;
  totalPoints: number;
  totalPayout: number;
  pendingPayout: number;
}

interface WaveStats {
  totalIssues: number;
  completedIssues: number;
  totalPointsAllocated: number;
  totalDisbursed: number;
  activeContributors: number;
}
```

### UI Components

**Main Component:** `apps/web/src/components/wave-dashboard/WaveDashboard.tsx`

**Sub-Components:**
- `WaveIssueList.tsx` — Issue table with filtering/sorting
- `ContributorLeaderboard.tsx` — Contributor rankings
- `WaveStatsOverview.tsx` — Program statistics

**Styling:** `WaveDashboard.css` — Responsive, mobile-first design

---

## Testing Coverage

**File:** `apps/web/tests/wave-dashboard.test.ts`

### Test Scenarios

✅ **Parsing:**
- Parse completed GitHub issue
- Parse in-progress issue
- Parse open issue
- Extract grant proposal ID from issue body
- Assign correct points for complexity

✅ **Cross-Referencing:**
- Link GitHub issues with on-chain disbursements
- Handle issues without disbursements
- Match by issue number accurately

✅ **Contributor Aggregation:**
- Calculate total issues
- Calculate completed issues
- Calculate total points
- Distinguish disbursed vs pending payouts

✅ **Statistics:**
- Count issues by status
- Sum points allocated
- Sum points disbursed
- Count active contributors

✅ **Edge Cases:**
- Handle stale claims (abandoned issues)
- Distinguish pending vs rejected payouts
- Handle missing data gracefully

**Coverage Target:** 90%+ achieved

---

## Security Considerations

### Data Privacy

**Public Information:**
- GitHub usernames (already public)
- Issue titles and descriptions (already public)
- On-chain addresses and transaction hashes (inherently public)

**No Sensitive Data:**
- No email addresses
- No real names (unless voluntarily provided in GitHub profile)
- No off-chain payment details

### API Security

**GitHub API:**
- Read-only access
- No authentication required for public repositories
- Rate limiting handled gracefully

**Indexer API:**
- Read-only queries
- No authentication required for public data
- HTTPS only

### Cross-Site Scripting (XSS)

**Protection:**
- All user-generated content sanitized
- Issue titles/descriptions rendered as plain text, not HTML
- External links use `target="_blank"` and `rel="noopener noreferrer"`

---

## Performance Optimization

### Caching Strategy

**Client-Side:**
- Cache GitHub API responses for 5 minutes
- Cache indexer API responses for 2 minutes
- Refresh button allows manual refresh

**Future Enhancement:**
- Server-side caching (Redis)
- Incremental updates (only fetch new issues)
- WebSocket for real-time updates

### Pagination

**Current:** Fetch all issues (limited to 100 by GitHub API)

**Future Enhancement:**
- Paginate issue list in UI (20 per page)
- Lazy load as user scrolls
- Fetch additional pages from GitHub API as needed

---

## Future Enhancements

### Planned Features

1. **Individual Contributor Profiles**
   - Dedicated page per contributor
   - Work history timeline
   - Badge collection (achievements)

2. **Notification System**
   - Email/Discord notifications for payout approvals
   - Alerts when new issues become available
   - Reminders for abandoned claims

3. **Detailed Payout Tracking**
   - Multi-currency support (USDC, EURC)
   - Payout history charts
   - Tax export (CSV)

4. **Issue Templates**
   - Standardized issue creation for Wave
   - Auto-assign complexity labels
   - Pre-fill grant proposal template

5. **Community Voting**
   - Let community vote on payout amounts
   - Dispute resolution for rejected payouts
   - Quality ratings for completed work

---

## Maintenance

### Regular Tasks

| Task | Frequency | Owner |
|------|-----------|-------|
| Verify cross-referencing accuracy | Weekly | Core team |
| Update complexity point mappings | As needed | Core team |
| Review stale claims | Bi-weekly | Core team |
| Sync GitHub labels with dashboard | On label changes | Core team |

### Monitoring

**Metrics to Track:**
- API error rates (GitHub, Indexer)
- Cross-referencing mismatch rate
- Dashboard load times
- User engagement (views, filters used)

**Alerting:**
- API failures (PagerDuty)
- Cross-referencing mismatches > 5% (email)
- Dashboard downtime (PagerDuty)

---

## Troubleshooting

### Issue: Disbursement not showing on dashboard

**Check:**
1. Is on-chain grant metadata correct? (`issue_number` field)
2. Has indexer synced recent ledgers?
3. Is issue labeled `wave` and `contributor-reward`?

**Fix:**
- Update grant metadata if incorrect
- Wait for indexer to catch up (~5 minutes)
- Add missing labels to GitHub issue

### Issue: Contributor stats incorrect

**Check:**
1. Are issue labels up to date?
2. Are there duplicate claims (reassignments)?
3. Cache stale?

**Fix:**
- Update issue labels
- Verify current assignee
- Clear cache and refresh

### Issue: GitHub API rate limit exceeded

**Symptoms:** Dashboard shows "Failed to fetch Wave issues"

**Fix:**
- Wait for rate limit reset (shown in error message)
- Use authenticated API calls (increases limit to 5000/hour)
- Reduce refresh frequency

---

## References

- **Treasury Contract:** `contracts/treasury/src/lib.rs`
- **Treasury Documentation:** `docs/treasury.md`
- **Indexer Service:** `services/indexer/`
- **GitHub API Docs:** https://docs.github.com/en/rest/issues
- **Stellar Transaction Explorer:** https://stellarchain.io

---

## Contributing

To improve the Wave dashboard:

1. Open an issue with feature request or bug report
2. Submit PR with proposed changes
3. Include tests for new functionality
4. Update this documentation

**Questions?** Ask in `#wave-contributors` on Discord.
