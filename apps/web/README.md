# Kora Protocol Web Application (`apps/web`)

Responsive mobile-first user interface and front-end integration layer for Kora Protocol.

## Implemented Features & Issues Addressed

### 1. Mobile-First Responsive Layout (`#781`)
- **Core Flows**: Mobile-first components built for invoice submission, marketplace browsing, fractional funding, and SME repayment.
- **Viewport Matrix**: Fully responsive from narrow mobile devices (320px width) up through desktop viewports.
- **Components**: `Header`, `Navigation`, `MobileDrawer`, `Layout`, `InvoiceSubmissionFlow`, `MarketplaceBrowsingFlow`, `FundingFlow`, `RepaymentFlow`.

### 2. In-App Notification Center (`#782`)
- **Features**: Bell icon with unread badge counter, slide-over notification panel, category filtering (Funding Milestones, Due Date Warnings, System Alerts, Governance), mark as read / mark all as read, and user preferences management.
- **Components**: `NotificationCenter`, `NotificationPanel`, `NotificationContext`, `notificationService`.

### 3. Currency & Locale Switcher (`#784`)
- **African Market Support**: Local currency converter supporting USD (USDC), NGN (Naira), KES (Shilling), ZAR (Rand), GHS (Cedi).
- **Canonical Display**: Always presents canonical on-chain settlement amounts (USDC) alongside converted local amounts.
- **Stale Data Indicator**: Automatically flags FX rates older than 1 hour as stale.
- **i18n Support**: Locale context with English (`en`), Swahili (`sw`), French (`fr`), Yoruba (`yo`), and Hausa (`ha`).
- **Components**: `CurrencySwitcher`, `LocaleSwitcher`, `FormattedAmount`, `LocaleContext`, `CurrencyContext`, `fxService`.

### 4. Transaction Simulation Preview (`#785`)
- **Pre-Flight Inspection**: Simulates Soroban smart contract calls prior to opening wallet signature prompts.
- **Decoded State Changes**: Provides human-readable previews of wallet balances, escrow changes, and protocol fee deductions.
- **Failure Blocking**: Blocks signature prompts when a transaction simulation fails or exceeds limits, preventing wasted gas and failed executions.
- **Components**: `SimulationPreviewModal`, `SimulationResultView`, `SimulationContext`, `simulationService`.

## Verification & Testing
Run unit tests and verification via:
```bash
cd apps/web
node tests/runTests.js
```
