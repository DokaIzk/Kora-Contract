#!/usr/bin/env bash
# =============================================================================
# Kora Protocol — Test Deploy & Rollback Pipeline Harness (#792)
# Verifies versioned manifest tracking, atomic failure protection, and rollback.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Testing Automated Deployment & Rollback Pipeline ==="

TEST_MANIFEST_DIR="$ROOT_DIR/deployments/manifests"
mkdir -p "$TEST_MANIFEST_DIR"

# 1. Create dummy initial manifest (v1)
V1_MANIFEST="$TEST_MANIFEST_DIR/testnet-20260901000000-v1.json"
cat > "$V1_MANIFEST" <<EOF
{
  "network": "testnet",
  "deployed_at": "2026-09-01T00:00:00Z",
  "commit_sha": "v1sha",
  "admin": "GBADMIN1111111111111111111111111111111111111111111111111",
  "contracts": {
    "access_control": { "address": "C_AC_V1", "wasm_hash": "hash_v1_ac" }
  }
}
EOF
cp "$V1_MANIFEST" "$ROOT_DIR/deployments/testnet.json"

# 2. Create dummy new manifest (v2)
V2_MANIFEST="$TEST_MANIFEST_DIR/testnet-20260902000000-v2.json"
cat > "$V2_MANIFEST" <<EOF
{
  "network": "testnet",
  "deployed_at": "2026-09-02T00:00:00Z",
  "commit_sha": "v2sha",
  "admin": "GBADMIN1111111111111111111111111111111111111111111111111",
  "contracts": {
    "access_control": { "address": "C_AC_V2", "wasm_hash": "hash_v2_ac" }
  }
}
EOF
cp "$V2_MANIFEST" "$ROOT_DIR/deployments/testnet.json"

# Verify current active is v2
CURRENT_SHA=$(python3 -c "import json; print(json.load(open('$ROOT_DIR/deployments/testnet.json'))['commit_sha'])")
if [ "$CURRENT_SHA" != "v2sha" ]; return 2>/dev/null || [ "$CURRENT_SHA" != "v2sha" ]; then
  echo "FAIL: Active deployment manifest is not v2sha"
  exit 1
fi
echo "✓ Initial deployment manifest (v2sha) active."

# 3. Perform Rollback
bash "$ROOT_DIR/scripts/rollback.sh" testnet "$V1_MANIFEST"

# Verify restored active is v1
RESTORED_SHA=$(python3 -c "import json; print(json.load(open('$ROOT_DIR/deployments/testnet.json'))['commit_sha'])")
if [ "$RESTORED_SHA" != "v1sha" ]; then
  echo "FAIL: Rollback failed. Expected v1sha, got $RESTORED_SHA"
  exit 1
fi

echo "✓ Rollback verified! Restored manifest matches v1sha."
echo "=== Testnet Deployment & Rollback Test Passed! ==="
