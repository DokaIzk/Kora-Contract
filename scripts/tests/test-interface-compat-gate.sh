#!/usr/bin/env bash
# =============================================================================
# Kora Protocol — Test Interface Compatibility Gate Harness (#793)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

TEST_MAIN_DIR=$(mktemp -d)
TEST_PR_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_MAIN_DIR" "$TEST_PR_DIR"' EXIT

mkdir -p "$TEST_MAIN_DIR" "$TEST_PR_DIR"

# Sample spec on main
cat > "$TEST_MAIN_DIR/treasury.txt" <<EOF
fn initialize(admin: Address, fee_bps: u32)
fn withdraw(admin: Address, token: Address, amount: i128)
EOF

# 1. Additive change test
cat > "$TEST_PR_DIR/treasury.txt" <<EOF
fn initialize(admin: Address, fee_bps: u32)
fn withdraw(admin: Address, token: Address, amount: i128)
fn emergency_withdraw(admin: Address, token: Address)
EOF

echo "--- Test 1: Additive change ---"
bash "$ROOT_DIR/scripts/check-interface-compat.sh" "$TEST_MAIN_DIR" "$TEST_PR_DIR" ""
echo "✓ Additive change passed."

# 2. Breaking change without label test
cat > "$TEST_PR_DIR/treasury.txt" <<EOF
fn initialize(admin: Address, fee_bps: u32)
EOF

echo ""
echo "--- Test 2: Breaking change without label ---"
if bash "$ROOT_DIR/scripts/check-interface-compat.sh" "$TEST_MAIN_DIR" "$TEST_PR_DIR" "" 2>/dev/null; then
  echo "FAIL: Expected breaking change without label to fail gate!"
  exit 1
fi
echo "✓ Breaking change correctly blocked by gate."

# 3. Breaking change with label test
echo ""
echo "--- Test 3: Breaking change with label & migration doc ---"
bash "$ROOT_DIR/scripts/check-interface-compat.sh" "$TEST_MAIN_DIR" "$TEST_PR_DIR" "interface-break-acknowledged"
echo "✓ Breaking change with label & migration doc approved."

echo ""
echo "=== Interface Compatibility Gate Test Passed! ==="
