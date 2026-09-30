# Kora Treasury Dashboard

Public-facing web dashboard providing real-time transparency into Kora Protocol treasury activity.

## Features

### 1. Real-Time Balances
- Current holdings across all supported assets
- Multi-asset display without misleading totals
- Direct links to token contracts for verification
- Optional USD value estimates (clearly labeled)

### 2. Fee Sweep History
- Chronological log of all protocol fee collections
- Source contract identification
- Transaction verification links
- Pagination for large datasets

### 3. Grant Disbursements
- All treasury grants with governance proposal links
- Recipient addresses and purpose descriptions
- Execution status (executed, pending, failed)
- On-chain transaction verification

### 4. Governance Outcomes
- Proposal details and voting results
- Treasury-affecting decisions highlighted
- Links to forum discussion threads
- Execution status and timestamps

## Architecture

```
React SPA (Vite + TypeScript)
         ↓
  Treasury API Client
         ↓
Analytics Service Backend
         ↓
  Soroban Event Indexer
         ↓
   On-Chain Contracts
```

## Technology Stack

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Blockchain**: Stellar SDK
- **API Client**: Axios

## Installation

```bash
npm install
```

## Configuration

Create `.env` file:

```bash
# Backend API endpoint
VITE_API_BASE_URL=https://api.kora.finance

# Stellar network (optional, for direct contract reads)
VITE_STELLAR_NETWORK=public
VITE_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org

# Block explorer base URL
VITE_EXPLORER_URL=https://stellar.expert/explorer/public
```

## Development

```bash
# Start dev server
npm run dev

# Type checking
npm run type-check

# Build for production
npm run build

# Preview production build
npm run preview
```

## Component Structure

```
src/
├── components/
│   ├── TreasuryBalances.tsx       # Current holdings display
│   ├── FeeSweepHistory.tsx        # Fee collection log
│   ├── GrantDisbursements.tsx     # Grant history
│   └── GovernanceOutcomes.tsx     # Proposal outcomes
├── services/
│   └── treasuryApi.ts             # Backend API client
├── utils/
│   └── format.ts                  # Formatting utilities
└── App.tsx                        # Main application
```

## API Contract

### GET /api/treasury/balances

Returns current treasury balances.

**Response:**
```json
[
  {
    "asset": "USDC",
    "assetCode": "USDC",
    "balance": "1234567890000",
    "balanceFormatted": "1,234,567.89",
    "usdValue": "1234567.89",
    "contractAddress": "CXXXXXXX...",
    "lastUpdated": 1727500000
  }
]
```

### GET /api/treasury/fee-sweeps

Returns fee sweep history with pagination.

**Query Params:**
- `limit` (number): Results per page
- `offset` (number): Skip N results
- `asset` (string): Filter by asset
- `fromDate` (timestamp): Start date
- `toDate` (timestamp): End date

**Response:**
```json
{
  "sweeps": [
    {
      "id": "sweep_123",
      "timestamp": 1727500000,
      "source": "Marketplace",
      "asset": "USDC",
      "amount": "123456000000",
      "amountFormatted": "1,234.56",
      "txHash": "0xabc...",
      "blockExplorerUrl": "https://..."
    }
  ],
  "total": 1234
}
```

### GET /api/treasury/grants

Returns grant disbursement history.

**Query Params:**
- `limit` (number): Results per page
- `offset` (number): Skip N results
- `status` (string): Filter by status (executed, pending, failed)
- `fromDate` (timestamp): Start date
- `toDate` (timestamp): End date

**Response:**
```json
{
  "grants": [
    {
      "id": "grant_456",
      "timestamp": 1727500000,
      "recipient": "GXXXXXXX...",
      "recipientLabel": "Marketing Team",
      "purpose": "Q4 Marketing Campaign",
      "asset": "USDC",
      "amount": "50000000000",
      "amountFormatted": "50,000.00",
      "proposalId": 42,
      "proposalUrl": "https://forum.../proposal/42",
      "txHash": "0xdef...",
      "blockExplorerUrl": "https://...",
      "status": "executed"
    }
  ],
  "total": 56
}
```

### GET /api/treasury/governance

Returns governance outcomes affecting treasury.

**Query Params:**
- `limit` (number): Results per page
- `offset` (number): Skip N results
- `outcome` (string): Filter by outcome (passed, failed, pending)

**Response:**
```json
{
  "proposals": [
    {
      "proposalId": 42,
      "title": "Marketing Grant Request",
      "proposalType": "Financial",
      "votingMode": "Standard",
      "votesFor": "1234567",
      "votesAgainst": "345678",
      "votesAbstain": "12345",
      "quorumRequired": "1000000",
      "outcome": "passed",
      "executed": true,
      "createdAt": 1727400000,
      "expiresAt": 1728004800,
      "executedAt": 1727600000,
      "forumUrl": "https://forum.../42",
      "txHash": "0x123...",
      "blockExplorerUrl": "https://..."
    }
  ],
  "total": 120
}
```

### GET /api/treasury/stats

Returns summary statistics.

**Response:**
```json
{
  "totalValueUsd": "2345678.90",
  "totalFeesCollected": "3456789.01",
  "totalGrantsDisbursed": "1234567.89",
  "activeProposals": 5,
  "executedProposals": 115
}
```

## Design Principles

### 1. Verification First
Every displayed figure must link to its source:
- Balances → Token contract state
- Transactions → Block explorer
- Proposals → Governance contract + forum

### 2. Multi-Asset Clarity
Never conflate different assets:
- Display each asset separately
- USD values clearly labeled as estimates
- Source exchange rates visible

### 3. No Authentication
Public dashboard, no login required:
- Read-only data access
- No user accounts or sessions
- Accessible to anyone

### 4. Real-Time Updates
Live data within reasonable bounds:
- 30-second refresh for balances
- Event-driven updates via WebSocket (optional)
- Clear timestamp on all data

## Testing

```bash
npm test
```

Test coverage includes:
- Component rendering
- API client methods
- Formatting utilities
- Error handling
- Pagination logic

## Deployment

### Build

```bash
npm run build
```

Output in `dist/` directory.

### Static Hosting

Deploy to:
- Vercel
- Netlify
- AWS S3 + CloudFront
- IPFS (for decentralized hosting)

### Environment Variables

Production environment:
```bash
VITE_API_BASE_URL=https://api.kora.finance
VITE_EXPLORER_URL=https://stellar.expert/explorer/public
```

## Security Considerations

1. **No Secrets**: Dashboard has no API keys or secrets
2. **CORS**: Backend API must allow public origin
3. **Rate Limiting**: Backend should rate-limit to prevent abuse
4. **XSS Protection**: All user data sanitized (React auto-escapes)
5. **Content Security Policy**: Restrict external resources

## Performance Optimization

1. **Code Splitting**: Dynamic imports for heavy components
2. **Lazy Loading**: Load data on-demand with pagination
3. **Caching**: Cache API responses with short TTL
4. **Memoization**: React.memo for expensive renders
5. **Virtual Scrolling**: For large transaction lists

## Accessibility

- Semantic HTML elements
- ARIA labels for screen readers
- Keyboard navigation support
- Color contrast compliance (WCAG AA)
- Responsive design for mobile

## Browser Support

- Chrome/Edge (last 2 versions)
- Firefox (last 2 versions)
- Safari (last 2 versions)
- Mobile browsers (iOS Safari, Chrome Android)

## Future Enhancements

1. **Historical Charts**: Balance and activity over time
2. **CSV Export**: Download data for external analysis
3. **Search**: Filter by address, asset, date range
4. **Notifications**: Subscribe to treasury events
5. **Dark Mode**: User preference theming
6. **i18n**: Multi-language support

## License

MIT
