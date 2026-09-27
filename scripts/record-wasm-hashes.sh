#!/usr/bin/env bash
# =============================================================================
# Kora Protocol — Record WASM Hashes for Release
# =============================================================================
#
# Usage:
#   ./scripts/record-wasm-hashes.sh <version>
#
# Example:
#   ./scripts/record-wasm-hashes.sh v0.2.0
#
# This script:
#   1. Verifies WASM binaries are built
#   2. Computes SHA-256 hashes for all contracts
#   3. Stores hashes in releases/<version>.hashes
#   4. Outputs verification commands
#
# =============================================================================

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "ERROR: Version required. Usage: $0 <version>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WASM_DIR="$ROOT_DIR/target/wasm32-unknown-unknown/release"
RELEASES_DIR="$ROOT_DIR/releases"
HASHES_FILE="$RELEASES_DIR/$VERSION.hashes"

# ── Validation ─────────────────────────────────────────────────────────────

echo "=== Kora Protocol — Record WASM Hashes ==="
echo "Version: $VERSION"
echo ""

if [ ! -d "$WASM_DIR" ]; then
  echo "ERROR: WASM directory not found: $WASM_DIR"
  echo "Build contracts first: make build-optimized"
  exit 1
fi

mkdir -p "$RELEASES_DIR"

CONTRACTS=(
  "access_control"
  "invoice_nft"
  "marketplace"
  "financing_pool"
  "treasury"
  "risk_registry"
)

# ── Record Hashes ──────────────────────────────────────────────────────────

echo "Recording WASM hashes..."

> "$HASHES_FILE"  # Create empty file

for contract in "${CONTRACTS[@]}"; do
  WASM="$WASM_DIR/kora_${contract}.wasm"

  if [ ! -f "$WASM" ]; then
    echo "WARNING: WASM not found: $WASM (skipping)"
    continue
  fi

  # Compute SHA-256 hash
  HASH=$(sha256sum "$WASM" | awk '{print $1}')

  # Store in format: HASH <path>
  echo "$HASH  target/wasm32-unknown-unknown/release/kora_${contract}.wasm" >> "$HASHES_FILE"

  echo "  ✓ $contract: $HASH"
done

echo ""
echo "Hashes recorded to: $HASHES_FILE"
echo ""

# ── Output Verification Commands ───────────────────────────────────────────

echo "To verify locally:"
echo "  sha256sum -c $HASHES_FILE"
echo ""

echo "To verify deployed contracts match this release:"
echo "  # Download hashes"
echo "  curl -sL https://github.com/OpenLedger-Foundation/Kora-Contract/releases/download/$VERSION/$VERSION.hashes -o released.hashes"
echo "  "
echo "  # Compare"
echo "  sha256sum -c released.hashes"
echo ""

# ── Update WASM metrics baseline ──────────────────────────────────────────────

echo "Updating WASM metrics baseline..."
if cargo run -p kora-xtask --bin wasm-metrics -- measure-wasm \
    --out "$ROOT_DIR/baselines/wasm-metrics.json" 2>/dev/null; then
  echo "  ✓ baselines/wasm-metrics.json updated"
else
  echo "  WARNING: could not update metrics baseline (xtask build failed — skipping)"
fi

echo ""
echo "Next steps:"
echo "  1. Review CHANGELOG.md and ensure [Unreleased] → [$VERSION]"
echo "  2. Commit: git add $HASHES_FILE baselines/wasm-metrics.json && git commit -m 'chore: record WASM hashes and metrics baseline for $VERSION'"
echo "  3. Tag:    git tag -a $VERSION -m 'Release $VERSION'"
echo "  4. Push:   git push origin $VERSION"
echo "  5. Release: gh release create $VERSION --notes 'See CHANGELOG.md' $HASHES_FILE"
