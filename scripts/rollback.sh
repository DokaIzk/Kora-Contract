#!/usr/bin/env bash
# =============================================================================
# Kora Protocol — Deployment Rollback Script
# Rollback testnet or mainnet deployment to a previous known-good manifest.
#
# Usage:
#   ./scripts/rollback.sh [testnet|mainnet] [manifest_path]
# =============================================================================

set -euo pipefail

NETWORK="${1:-testnet}"
TARGET_MANIFEST="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_LOG="$ROOT_DIR/deployments/$NETWORK.json"
MANIFEST_DIR="$ROOT_DIR/deployments/manifests"

echo "=== Kora Protocol — Deployment Rollback ==="
echo "Network: $NETWORK"

if [ -z "$TARGET_MANIFEST" ]; then
  # Find second-to-last versioned manifest if no manifest specified
  MANIFESTS=$(ls -1t "$MANIFEST_DIR"/${NETWORK}-*.json 2>/dev/null || true)
  PREV_MANIFEST=$(echo "$MANIFESTS" | sed -n '2p')

  if [ -z "$PREV_MANIFEST" ] || [ ! -f "$PREV_MANIFEST" ]; then
    echo "ERROR: No previous deployment manifest found in $MANIFEST_DIR to rollback to."
    exit 1
  fi
  TARGET_MANIFEST="$PREV_MANIFEST"
fi

if [ ! -f "$TARGET_MANIFEST" ]; then
  echo "ERROR: Specified rollback manifest not found: $TARGET_MANIFEST"
  exit 1
fi

echo "Rolling back to manifest: $TARGET_MANIFEST"

# Validate JSON structure
python3 -c "import json; json.load(open('$TARGET_MANIFEST'))" || {
  echo "ERROR: Invalid JSON in target rollback manifest $TARGET_MANIFEST"
  exit 1
}

# Atomically restore previous manifest as current active deployment log
cp "$TARGET_MANIFEST" "$DEPLOY_LOG"

TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
ROLLBACK_RECORD="$MANIFEST_DIR/${NETWORK}-rollback-${TIMESTAMP}.json"
cp "$TARGET_MANIFEST" "$ROLLBACK_RECORD"

echo "✓ Rollback successful!"
echo "Active deployment restored to: $DEPLOY_LOG"
echo "Rollback manifest recorded: $ROLLBACK_RECORD"
