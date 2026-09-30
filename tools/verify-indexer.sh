#!/usr/bin/env bash
#
# Cross-Verification Tool for Community Kora Indexer Nodes
#
# Compares local indexer output against canonical instance to detect
# discrepancies, ensuring community-run infrastructure matches protocol state.
#
# Usage:
#   ./verify-indexer.sh \
#     --local-db postgresql://localhost:5432/kora \
#     --canonical-api https://api.kora.finance \
#     --start-ledger 1000000 \
#     --end-ledger 1001000
#

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

LOCAL_DB=""
CANONICAL_API=""
START_LEDGER=""
END_LEDGER=""
VERBOSE=false
OUTPUT_DIR="./verification-results"

# ── Argument Parsing ──────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case $1 in
        --local-db)
            LOCAL_DB="$2"
            shift 2
            ;;
        --canonical-api)
            CANONICAL_API="$2"
            shift 2
            ;;
        --start-ledger)
            START_LEDGER="$2"
            shift 2
            ;;
        --end-ledger)
            END_LEDGER="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 --local-db <db_url> --canonical-api <api_url> --start-ledger <num> --end-ledger <num> [--verbose] [--output-dir <dir>]"
            exit 1
            ;;
    esac
done

# ── Validation ────────────────────────────────────────────────────────────────

if [[ -z "$LOCAL_DB" || -z "$CANONICAL_API" || -z "$START_LEDGER" || -z "$END_LEDGER" ]]; then
    echo "Error: Missing required arguments"
    echo "Usage: $0 --local-db <db_url> --canonical-api <api_url> --start-ledger <num> --end-ledger <num>"
    exit 1
fi

# ── Setup ─────────────────────────────────────────────────────────────────────

mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$OUTPUT_DIR/verification_report_$TIMESTAMP.txt"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$REPORT_FILE"
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo "[VERBOSE] $*" | tee -a "$REPORT_FILE"
    fi
}

# ── Dependency Checks ─────────────────────────────────────────────────────────

if ! command -v psql &> /dev/null; then
    echo "Error: psql not found. Install PostgreSQL client tools."
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo "Error: curl not found. Install curl."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq not found. Install jq for JSON processing."
    exit 1
fi

# ── Main Verification ─────────────────────────────────────────────────────────

log "========================================="
log "Kora Indexer Verification Report"
log "========================================="
log "Local Database: $LOCAL_DB"
log "Canonical API: $CANONICAL_API"
log "Ledger Range: $START_LEDGER - $END_LEDGER"
log ""

# ── 1. Event Count Comparison ─────────────────────────────────────────────────

log "1. Comparing Event Counts..."

# Query local database for event counts by type
LOCAL_EVENTS=$(psql "$LOCAL_DB" -t -c "
    SELECT event_type, COUNT(*) as count
    FROM events
    WHERE ledger_sequence >= $START_LEDGER AND ledger_sequence <= $END_LEDGER
    GROUP BY event_type
    ORDER BY event_type;
" 2>/dev/null || echo "ERROR")

if [[ "$LOCAL_EVENTS" == "ERROR" ]]; then
    log "   ❌ ERROR: Failed to query local database"
    exit 1
fi

# Query canonical API for event counts
CANONICAL_EVENTS=$(curl -s "$CANONICAL_API/api/v1/events/summary?start_ledger=$START_LEDGER&end_ledger=$END_LEDGER" | jq -r '.counts | to_entries[] | "\(.key) \(.value)"' 2>/dev/null || echo "ERROR")

if [[ "$CANONICAL_EVENTS" == "ERROR" ]]; then
    log "   ⚠️  WARNING: Failed to query canonical API"
else
    log_verbose "Local events:"
    log_verbose "$LOCAL_EVENTS"
    log_verbose "Canonical events:"
    log_verbose "$CANONICAL_EVENTS"

    # Compare counts
    MISMATCH=false
    while IFS= read -r line; do
        local_type=$(echo "$line" | awk '{print $1}' | xargs)
        local_count=$(echo "$line" | awk '{print $2}' | xargs)
        
        canonical_count=$(echo "$CANONICAL_EVENTS" | grep "^$local_type " | awk '{print $2}' || echo "0")
        
        if [[ "$local_count" != "$canonical_count" ]]; then
            log "   ❌ MISMATCH: $local_type - Local: $local_count, Canonical: $canonical_count"
            MISMATCH=true
        else
            log "   ✅ MATCH: $local_type - Count: $local_count"
        fi
    done <<< "$LOCAL_EVENTS"
    
    if [[ "$MISMATCH" == "false" ]]; then
        log "   ✅ All event counts match"
    fi
fi

log ""

# ── 2. Invoice State Comparison ───────────────────────────────────────────────

log "2. Comparing Invoice States..."

# Sample 10 random invoices from the ledger range
SAMPLE_INVOICES=$(psql "$LOCAL_DB" -t -c "
    SELECT DISTINCT invoice_id
    FROM events
    WHERE ledger_sequence >= $START_LEDGER AND ledger_sequence <= $END_LEDGER
      AND event_type LIKE 'invoice_%'
    ORDER BY RANDOM()
    LIMIT 10;
" 2>/dev/null | xargs)

if [[ -n "$SAMPLE_INVOICES" ]]; then
    for invoice_id in $SAMPLE_INVOICES; do
        log_verbose "Checking invoice: $invoice_id"
        
        # Get local invoice state
        LOCAL_STATE=$(psql "$LOCAL_DB" -t -c "
            SELECT status, funded_amount, outstanding_amount
            FROM invoices
            WHERE invoice_id = $invoice_id;
        " 2>/dev/null || echo "ERROR")
        
        # Get canonical invoice state
        CANONICAL_STATE=$(curl -s "$CANONICAL_API/api/v1/invoices/$invoice_id" | jq -r '[.status, .funded_amount, .outstanding_amount] | @tsv' 2>/dev/null || echo "ERROR")
        
        if [[ "$LOCAL_STATE" != "$CANONICAL_STATE" ]]; then
            log "   ❌ MISMATCH: Invoice $invoice_id"
            log "      Local: $LOCAL_STATE"
            log "      Canonical: $CANONICAL_STATE"
        else
            log "   ✅ MATCH: Invoice $invoice_id"
        fi
    done
else
    log "   ⚠️  No invoices found in this ledger range"
fi

log ""

# ── 3. Transaction Hash Verification ──────────────────────────────────────────

log "3. Verifying Transaction Hashes..."

# Sample 20 random transactions
SAMPLE_TXS=$(psql "$LOCAL_DB" -t -c "
    SELECT DISTINCT tx_hash
    FROM events
    WHERE ledger_sequence >= $START_LEDGER AND ledger_sequence <= $END_LEDGER
    ORDER BY RANDOM()
    LIMIT 20;
" 2>/dev/null | xargs)

TX_MISMATCHES=0
TX_MATCHES=0

if [[ -n "$SAMPLE_TXS" ]]; then
    for tx_hash in $SAMPLE_TXS; do
        log_verbose "Checking transaction: $tx_hash"
        
        # Check if canonical API has this transaction
        CANONICAL_TX=$(curl -s "$CANONICAL_API/api/v1/transactions/$tx_hash" 2>/dev/null | jq -r '.tx_hash // "NOT_FOUND"')
        
        if [[ "$CANONICAL_TX" == "NOT_FOUND" ]]; then
            log "   ❌ MISSING: Transaction $tx_hash not found in canonical indexer"
            TX_MISMATCHES=$((TX_MISMATCHES + 1))
        else
            TX_MATCHES=$((TX_MATCHES + 1))
        fi
    done
    
    log "   Transaction Hash Summary: $TX_MATCHES matches, $TX_MISMATCHES mismatches"
    if [[ $TX_MISMATCHES -eq 0 ]]; then
        log "   ✅ All sampled transactions found in canonical indexer"
    fi
else
    log "   ⚠️  No transactions found in this ledger range"
fi

log ""

# ── 4. Ledger Sequence Gaps ───────────────────────────────────────────────────

log "4. Checking for Ledger Sequence Gaps..."

GAPS=$(psql "$LOCAL_DB" -t -c "
    WITH ledger_range AS (
        SELECT generate_series($START_LEDGER, $END_LEDGER) AS expected_ledger
    ),
    indexed_ledgers AS (
        SELECT DISTINCT ledger_sequence FROM events
        WHERE ledger_sequence >= $START_LEDGER AND ledger_sequence <= $END_LEDGER
    )
    SELECT lr.expected_ledger
    FROM ledger_range lr
    LEFT JOIN indexed_ledgers il ON lr.expected_ledger = il.ledger_sequence
    WHERE il.ledger_sequence IS NULL
    ORDER BY lr.expected_ledger;
" 2>/dev/null)

if [[ -n "$GAPS" ]]; then
    GAP_COUNT=$(echo "$GAPS" | wc -l)
    log "   ❌ Found $GAP_COUNT missing ledgers:"
    log_verbose "$GAPS"
    log "   First missing: $(echo "$GAPS" | head -n 1)"
    log "   Last missing: $(echo "$GAPS" | tail -n 1)"
else
    log "   ✅ No ledger gaps detected"
fi

log ""

# ── 5. Sync Status Check ──────────────────────────────────────────────────────

log "5. Checking Sync Status..."

# Get latest local ledger
LOCAL_LATEST=$(psql "$LOCAL_DB" -t -c "
    SELECT MAX(ledger_sequence) FROM events;
" 2>/dev/null | xargs)

# Get latest canonical ledger
CANONICAL_LATEST=$(curl -s "$CANONICAL_API/api/v1/status" | jq -r '.latest_ledger // "ERROR"' 2>/dev/null)

if [[ "$CANONICAL_LATEST" != "ERROR" ]]; then
    LAG=$((CANONICAL_LATEST - LOCAL_LATEST))
    log "   Local Latest Ledger: $LOCAL_LATEST"
    log "   Canonical Latest Ledger: $CANONICAL_LATEST"
    log "   Lag: $LAG ledgers"
    
    if [[ $LAG -gt 100 ]]; then
        log "   ⚠️  WARNING: Local indexer is significantly behind (>100 ledgers)"
    elif [[ $LAG -gt 10 ]]; then
        log "   ⚠️  Local indexer is slightly behind (>10 ledgers)"
    else
        log "   ✅ Local indexer is up-to-date"
    fi
else
    log "   ⚠️  Could not fetch canonical sync status"
fi

log ""

# ── 6. Database Health Metrics ────────────────────────────────────────────────

log "6. Database Health Metrics..."

# Table sizes
TABLE_SIZES=$(psql "$LOCAL_DB" -t -c "
    SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    LIMIT 5;
" 2>/dev/null)

log "   Top 5 Largest Tables:"
log "$TABLE_SIZES"

# Index usage
INDEX_USAGE=$(psql "$LOCAL_DB" -t -c "
    SELECT schemaname, tablename, indexname, idx_scan
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY idx_scan DESC
    LIMIT 5;
" 2>/dev/null)

log ""
log "   Top 5 Most Used Indexes:"
log "$INDEX_USAGE"

log ""

# ── Summary ───────────────────────────────────────────────────────────────────

log "========================================="
log "Verification Complete"
log "========================================="
log "Report saved to: $REPORT_FILE"
log ""

# Exit with error code if significant issues found
if [[ "$MISMATCH" == "true" ]] || [[ $TX_MISMATCHES -gt 5 ]] || [[ -n "$GAPS" && $(echo "$GAPS" | wc -l) -gt 10 ]]; then
    log "❌ VERIFICATION FAILED: Significant discrepancies detected"
    exit 1
else
    log "✅ VERIFICATION PASSED: No significant issues detected"
    exit 0
fi
