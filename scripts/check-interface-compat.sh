#!/usr/bin/env bash
# =============================================================================
# Kora Protocol — Interface Compatibility Checker (#793)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MAIN_SPECS_DIR="${1:-$ROOT_DIR/specs/main}"
PR_SPECS_DIR="${2:-$ROOT_DIR/specs/pr}"
PR_LABELS="${3:-}"

echo "=== Kora Protocol — Interface Compatibility Checker ==="

CONTRACTS="access_control financing_pool invoice_nft marketplace price_oracle risk_registry treasury"
HAS_BREAKING=0

for c in $CONTRACTS; do
  main_spec="$MAIN_SPECS_DIR/${c}.txt"
  pr_spec="$PR_SPECS_DIR/${c}.txt"

  if [ ! -f "$main_spec" ]; then
    continue
  fi
  if [ ! -f "$pr_spec" ]; then
    echo "WARNING: Contract '$c' spec missing in PR branch!"
    HAS_BREAKING=1
    continue
  fi

  diff_out=$(diff -u "$main_spec" "$pr_spec" || true)
  if [ -n "$diff_out" ]; then
    removed=$(echo "$diff_out" | grep -c '^-[^-]' | tr -d ' \n\r' || echo 0)

    if [ "${removed:-0}" -gt 0 ]; then
      echo "❌ BREAKING: $c has $removed removed line(s) from public interface!"
      HAS_BREAKING=1
    else
      echo "✓ ADDITIVE: $c has non-breaking interface additions."
    fi
  else
    echo "✓ UNCHANGED: $c interface matches main exactly."
  fi
done

if [ "$HAS_BREAKING" -eq 1 ]; then
  echo ""
  echo "Checking breaking change acknowledgment overrides..."

  HAS_ACK_LABEL=0
  if echo "$PR_LABELS" | grep -q "interface-break-acknowledged"; then
    HAS_ACK_LABEL=1
  fi

  HAS_MIGRATION_DOC=0
  if [ -f "$ROOT_DIR/docs/MIGRATIONS.md" ]; then
    HAS_MIGRATION_DOC=1
  fi

  if [ "$HAS_ACK_LABEL" -eq 1 ] && [ "$HAS_MIGRATION_DOC" -eq 1 ]; then
    echo "✓ OVERRIDE APPROVED: Label 'interface-break-acknowledged' present and docs/MIGRATIONS.md updated."
    exit 0
  else
    echo "❌ FAILED: Breaking interface change detected."
    echo "To bypass, add label 'interface-break-acknowledged' to PR AND document breaking change in docs/MIGRATIONS.md"
    exit 1
  fi
fi

echo "✓ Compatibility check passed."
exit 0
