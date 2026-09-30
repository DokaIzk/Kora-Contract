# Wave Contributor Dashboard

Public-facing dashboard for tracking Wave-style contributor initiatives with full transparency from GitHub to on-chain payouts.

## Quick Start

```typescript
import { WaveDashboard } from './src/components/wave-dashboard';

// In your app
<WaveDashboard />
```

## Features

✅ **Issue Tracking**
- Real-time sync with GitHub issues
- Complexity-based point values (Low: 50, Medium: 100, High: 200)
- Status tracking: Open → Claimed → In Progress → Completed
- Filterable and sortable issue list

✅ **Payout Transparency**
- Cross-references GitHub with on-chain treasury disbursements
- Payout status: Pending → Approved → Disbursed
- Links to Stellar transaction explorer
- Shows grant proposal IDs

✅ **Contributor Leaderboard**
- Ranks by total points earned
- Shows completed issues, disbursed payouts, pending payouts
- Links to GitHub profiles

✅ **Program Statistics**
- Total issues, completion rate
- Active contributors
- Points allocated vs disbursed
- Visual breakdown charts

## Architecture

```
GitHub Issues API ─┐
                   ├──▶ WaveService ──▶ Dashboard UI
Indexer API ───────┘
```

### Data Flow

1. **GitHub**: Fetches issues labeled `wave` + `contributor-reward`
2. **Indexer**: Fetches treasury grant disbursements
3. **Cross-Reference**: Matches issues to disbursements by issue number
4. **Display**: Shows unified view with real-time status

## Configuration

Set environment variables in `.env`:

```bash
# GitHub repository to track
GITHUB_REPO=kora-finance/contracts

# Indexer API endpoint
INDEXER_API_BASE=https://api.kora.finance
```

## Components

### Main Dashboard
`WaveDashboard.tsx` - Container with navigation between views

### Issue List
`WaveIssueList.tsx` - Filterable/sortable table of all Wave issues

### Contributor Leaderboard
`ContributorLeaderboard.tsx` - Rankings and contributor stats

### Statistics Overview
`WaveStatsOverview.tsx` - Program-wide metrics and charts

## Service Layer

`waveService.ts` provides all data fetching and processing:

```typescript
import { waveService } from './services/waveService';

// Fetch issues with on-chain payout data
const issues = await waveService.fetchWaveIssuesWithDisbursements();

// Get contributor statistics
const contributors = await waveService.fetchContributors();

// Get program statistics
const stats = await waveService.fetchWaveStats();
```

## Type Definitions

All types defined in `types/wave.ts`:

- `WaveIssue` - Issue with status and payout info
- `Contributor` - Aggregated contributor statistics
- `GrantDisbursement` - On-chain payout record
- `WaveStats` - Program-wide statistics
- `WaveIssueStatus` - Open | Claimed | In Progress | Completed | Abandoned
- `PayoutStatus` - Pending | Approved | Disbursed | Rejected | Not Eligible

## Testing

```bash
npm test -- wave-dashboard.test.ts
```

**Coverage:** 90%+ across all core functionality

Tests cover:
- GitHub issue parsing
- Cross-referencing logic
- Contributor aggregation
- Statistics calculation
- Edge cases (stale claims, missing data)

## Cross-Referencing Logic

Issues are linked to on-chain disbursements by **issue number**:

**GitHub Issue Body:**
```markdown
## Description
Build the vesting contract

Grant Proposal: #1
```

**On-Chain Grant Metadata:**
```json
{
  "proposal_id": 1,
  "metadata": {
    "issue_number": 100
  }
}
```

**Result:** Issue #100 shows as "Disbursed" with link to transaction

## Point Values

| Complexity | Points | GitHub Label |
|------------|--------|--------------|
| Low | 50 | `Low` |
| Medium | 100 | `Medium` |
| High | 200 | `High` |

## Status Workflow

```
Open ──▶ Claimed ──▶ In Progress ──▶ Completed
          │                            │
          └─────▶ Abandoned ◀──────────┘
```

## Payout Workflow

```
Pending ──▶ Approved ──▶ Disbursed
   │
   └───────▶ Rejected / Not Eligible
```

## Security

- Read-only API access (no write permissions)
- All data already public (GitHub + blockchain)
- XSS protection via content sanitization
- External links use `rel="noopener noreferrer"`

## Performance

- Client-side caching (5 min for GitHub, 2 min for indexer)
- Manual refresh button
- Handles 100+ issues efficiently
- Responsive design for mobile

## Troubleshooting

### Disbursement not showing
- Check grant metadata includes `issue_number`
- Wait for indexer sync (~5 minutes)
- Verify issue has `wave` label

### Stats seem incorrect
- Clear cache and refresh
- Check for label updates on GitHub
- Verify issue assignee is current

### API rate limit
- GitHub: 60/hour unauthenticated, 5000/hour authenticated
- Add auth token to increase limit
- Use refresh button instead of auto-polling

## Future Enhancements

- [ ] Individual contributor profile pages
- [ ] Email/Discord notifications for payouts
- [ ] Multi-currency payout support
- [ ] Community voting on payout amounts
- [ ] Historical payout charts
- [ ] Real-time updates via WebSocket

## Documentation

See `docs/wave-dashboard.md` for comprehensive documentation.

## Related

- Treasury contract: `contracts/treasury/src/lib.rs`
- Indexer service: `services/indexer/`
- Treasury docs: `docs/treasury.md`

## Contributing

1. Open issue for feature request or bug
2. Submit PR with tests
3. Update documentation
4. Get review from core team

Questions? Ask in `#wave-contributors` on Discord.
