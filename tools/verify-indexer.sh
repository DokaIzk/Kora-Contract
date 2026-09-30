#!/bin/bash
# tools/verify-indexer.sh
# Cross-verification tool for community-run Kora indexer instances
#
# Compares local indexer output against canonical instance to ensure:
# - Correct RPC node synchronization
# - Matching event processing logic
# - No data corruption or missed events
#
# Usage:
#   CANONICAL_URL=https://indexer.kora.finance \
#   LOCAL_URL=http://localhost:3000 \
#   SAMPLE_SIZE=100 \
#     ./tools/verify-indexer.sh

set -e

# Configuration
CANONICAL_URL="${CANONICAL_URL:-https://indexer-testnet.kora.finance}"
LOCAL_URL="${LOCAL_URL:-http://localhost:3000}"
SAMPLE_SIZE="${SAMPLE_SIZE:-100}"
VERBOSE="${VERBOSE:-0}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check dependencies
command -v curl >/dev/null 2>&1 || { log_error "curl is required but not installed. Aborting."; exit 1; }
command -v jq >/dev/null 2>&1 || { log_error "jq is required but not installed. Aborting."; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { log_error "sha256sum is required but not installed. Aborting."; exit 1; }

log_info "Starting Kora Indexer Cross-Verification"
log_info "Canonical: $CANONICAL_URL"
log_info "Local:     $LOCAL_URL"
log_info "Sample:    $SAMPLE_SIZE events"
echo ""

# Check connectivity
log_info "Checking connectivity to canonical indexer..."
if ! curl -sf "$CANONICAL_URL/api/v1/health" > /dev/null; then
    log_error "Cannot reach canonical indexer at $CANONICAL_URL"
    log_error "Check your internet connection or CANONICAL_URL configuration"
    exit 1
fi
log_info "✓ Canonical indexer reachable"

log_info "Checking connectivity to local indexer..."
if ! curl -sf "$LOCAL_URL/api/v1/health" > /dev/null; then
    log_error "Cannot reach local indexer at $LOCAL_URL"
    log_error "Ensure your local indexer is running and accessible"
    exit 1
fi
log_info "✓ Local indexer reachable"
echo ""

# Compare health status
log_info "Comparing indexer health status..."
CANONICAL_HEALTH=$(curl -sf "$CANONICAL_URL/api/v1/health")
LOCAL_HEALTH=$(curl -sf "$LOCAL_URL/api/v1/health")

CANONICAL_LEDGER=$(echo "$CANONICAL_HEALTH" | jq -r '.last_indexed_ledger')
LOCAL_LEDGER=$(echo "$LOCAL_HEALTH" | jq -r '.last_indexed_ledger')
CHAIN_TIP=$(echo "$CANONICAL_HEALTH" | jq -r '.chain_tip')

log_info "Canonical last indexed: $CANONICAL_LEDGER"
log_info "Local last indexed:     $LOCAL_LEDGER"
log_info "Chain tip:              $CHAIN_TIP"

LAG=$((CHAIN_TIP - LOCAL_LEDGER))
if [ $LAG -gt 300 ]; then
    log_warn "Local indexer is lagging by $LAG ledgers (>300)"
    log_warn "Wait for indexer to catch up before running verification"
    exit 2
elif [ $LAG -gt 100 ]; then
    log_warn "Local indexer is lagging by $LAG ledgers"
fi

if [ $LOCAL_LEDGER -lt $CANONICAL_LEDGER ]; then
    log_warn "Local indexer ($LOCAL_LEDGER) is behind canonical ($CANONICAL_LEDGER)"
    log_warn "Verification will compare only up to local ledger height"
    SAMPLE_SIZE=$((SAMPLE_SIZE / 2))
    log_info "Reducing sample size to $SAMPLE_SIZE for fair comparison"
fi
echo ""

# Fetch events for comparison
log_info "Fetching $SAMPLE_SIZE recent events from canonical indexer..."
CANONICAL_EVENTS=$(curl -sf "$CANONICAL_URL/api/v1/events?limit=$SAMPLE_SIZE&sort=desc")
if [ -z "$CANONICAL_EVENTS" ]; then
    log_error "Failed to fetch events from canonical indexer"
    exit 1
fi
CANONICAL_COUNT=$(echo "$CANONICAL_EVENTS" | jq -r '. | length')
log_info "✓ Fetched $CANONICAL_COUNT events from canonical"

log_info "Fetching $SAMPLE_SIZE recent events from local indexer..."
LOCAL_EVENTS=$(curl -sf "$LOCAL_URL/api/v1/events?limit=$SAMPLE_SIZE&sort=desc")
if [ -z "$LOCAL_EVENTS" ]; then
    log_error "Failed to fetch events from local indexer"
    exit 1
fi
LOCAL_COUNT=$(echo "$LOCAL_EVENTS" | jq -r '. | length')
log_info "✓ Fetched $LOCAL_COUNT events from local"
echo ""

# Normalize and hash for comparison
log_info "Computing event hashes..."
CANONICAL_HASH=$(echo "$CANONICAL_EVENTS" | jq -S '.' | sha256sum | awk '{print $1}')
LOCAL_HASH=$(echo "$LOCAL_EVENTS" | jq -S '.' | sha256sum | awk '{print $1}')

# Compare hashes
echo ""
log_info "Comparing event data..."
if [ "$CANONICAL_HASH" == "$LOCAL_HASH" ]; then
    echo ""
    log_info "════════════════════════════════════════════════════════"
    log_info "✅ VERIFICATION PASSED"
    log_info "════════════════════════════════════════════════════════"
    log_info "Your local indexer matches the canonical instance!"
    log_info ""
    log_info "Hash: $LOCAL_HASH"
    log_info "Events compared: $LOCAL_COUNT"
    log_info "Ledger range: $((LOCAL_LEDGER - SAMPLE_SIZE)) to $LOCAL_LEDGER"
    echo ""
    exit 0
else
    echo ""
    log_error "════════════════════════════════════════════════════════"
    log_error "❌ VERIFICATION FAILED"
    log_error "════════════════════════════════════════════════════════"
    log_error "Local indexer diverges from canonical instance"
    log_error ""
    log_error "Canonical hash: $CANONICAL_HASH"
    log_error "Local hash:     $LOCAL_HASH"
    echo ""
    
    log_info "Analyzing differences..."
    
    # Find first diverging event
    DIFF_OUTPUT=$(diff <(echo "$CANONICAL_EVENTS" | jq -S '.[] | {ledger: .ledger_sequence, index: .event_index, type: .event_type, contract: .contract}') \
                      <(echo "$LOCAL_EVENTS" | jq -S '.[] | {ledger: .ledger_sequence, index: .event_index, type: .event_type, contract: .contract}') 2>&1 || true)
    
    if [ -n "$DIFF_OUTPUT" ]; then
        log_error "First difference found:"
        echo "$DIFF_OUTPUT" | head -20
    fi
    
    echo ""
    log_error "Possible causes:"
    log_error "  1. Local indexer is out of sync (lag: $LAG ledgers)"
    log_error "  2. Software version mismatch (check: git describe --tags)"
    log_error "  3. Contract address configuration mismatch"
    log_error "  4. Database corruption (try: drop DB and re-index)"
    echo ""
    log_error "For help, see: docs/RUNNING_A_NODE.md#troubleshooting"
    exit 1
fi
