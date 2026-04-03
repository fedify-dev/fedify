#!/usr/bin/env bash
# Provision Sharkey for smoke tests.
#
# Uses ap/show API to discover Fedify account over HTTPS (via Caddy TLS).
# Talks to sharkey-web-backend directly (HTTP on port 3000) for API calls.
set -euo pipefail

SHARKEY_URL="http://localhost:3000"
SETUP_PASSWORD="smoke-test-setup"

echo "→ Creating admin account..."
ADMIN_RAW=$(curl -sf -X POST "$SHARKEY_URL/api/admin/accounts/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"admin\",
    \"password\": \"adminpassword123\",
    \"setupPassword\": \"$SETUP_PASSWORD\"
  }" 2>&1) || true
echo "  admin creation response: ${ADMIN_RAW:0:200}"

ADMIN_TOKEN=$(echo "$ADMIN_RAW" | jq -r '.token // empty' 2>/dev/null || true)
if [ -z "$ADMIN_TOKEN" ]; then
  echo "  Admin may already exist, signing in..."
  SIGN_IN=$(curl -sf -X POST "$SHARKEY_URL/api/signin" \
    -H "Content-Type: application/json" \
    -d '{"username": "admin", "password": "adminpassword123"}')
  ADMIN_TOKEN=$(echo "$SIGN_IN" | jq -r '.i // empty' 2>/dev/null || true)
fi

if [ -z "$ADMIN_TOKEN" ]; then
  echo "✗ Failed to obtain admin token"
  exit 1
fi
echo "  admin token: ${ADMIN_TOKEN:0:8}..."

echo "→ Creating test user via admin API..."
TEST_RAW=$(curl -sf -X POST "$SHARKEY_URL/api/admin/accounts/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"i\": \"$ADMIN_TOKEN\",
    \"username\": \"testuser\",
    \"password\": \"testpassword123\"
  }" 2>&1) || true
echo "  testuser creation response: ${TEST_RAW:0:200}"

# Try to extract token directly from the creation response
TEST_TOKEN=$(echo "$TEST_RAW" | jq -r '.token // empty' 2>/dev/null || true)

# If no token in creation response, sign in
if [ -z "$TEST_TOKEN" ]; then
  echo "→ Signing in as testuser..."
  SIGN_IN_RAW=$(curl -sf -X POST "$SHARKEY_URL/api/signin" \
    -H "Content-Type: application/json" \
    -d '{"username": "testuser", "password": "testpassword123"}' 2>&1) || true
  echo "  signin response: ${SIGN_IN_RAW:0:200}"
  TEST_TOKEN=$(echo "$SIGN_IN_RAW" | jq -r '.i // empty' 2>/dev/null || true)
fi

if [ -z "$TEST_TOKEN" ]; then
  echo "  Trying password reset flow..."
  TESTUSER_INFO=$(curl -sf -X POST "$SHARKEY_URL/api/users/show" \
    -H "Content-Type: application/json" \
    -d "{\"i\": \"$ADMIN_TOKEN\", \"username\": \"testuser\"}" 2>&1) || true
  TESTUSER_ID=$(echo "$TESTUSER_INFO" | jq -r '.id // empty' 2>/dev/null || true)

  if [ -n "$TESTUSER_ID" ]; then
    RESET_RAW=$(curl -sf -X POST "$SHARKEY_URL/api/admin/reset-password" \
      -H "Content-Type: application/json" \
      -d "{\"i\": \"$ADMIN_TOKEN\", \"userId\": \"$TESTUSER_ID\"}" 2>&1) || true
    echo "  reset-password response: ${RESET_RAW:0:200}"
    NEW_PASS=$(echo "$RESET_RAW" | jq -r '.password // empty' 2>/dev/null || true)
    if [ -n "$NEW_PASS" ]; then
      SIGN_IN_RAW=$(curl -sf -X POST "$SHARKEY_URL/api/signin" \
        -H "Content-Type: application/json" \
        -d "{\"username\": \"testuser\", \"password\": \"$NEW_PASS\"}" 2>&1) || true
      echo "  signin after reset response: ${SIGN_IN_RAW:0:200}"
      TEST_TOKEN=$(echo "$SIGN_IN_RAW" | jq -r '.i // empty' 2>/dev/null || true)
    fi
  fi
fi

if [ -z "$TEST_TOKEN" ]; then
  echo "✗ Failed to obtain test user token"
  exit 1
fi
echo "  testuser token: ${TEST_TOKEN:0:8}..."

TOKEN="$TEST_TOKEN"

echo "→ Verifying Mastodon-compatible API access..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$SHARKEY_URL/api/v1/accounts/verify_credentials")
echo "  verify_credentials → HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo "✗ Token verification failed (HTTP $HTTP_CODE)"
  exit 1
fi

echo "→ Resolving Fedify account via ap/show (HTTPS via Caddy)..."
FEDIFY_USER_ID=""
for i in $(seq 1 5); do
  RESOLVE_RAW=$(curl -s -X POST "$SHARKEY_URL/api/ap/show" \
    -H "Content-Type: application/json" \
    -d "{
      \"i\": \"$ADMIN_TOKEN\",
      \"uri\": \"https://fedify-harness/users/testuser\"
    }" 2>&1) || true
  echo "  ap/show attempt $i: ${RESOLVE_RAW:0:300}"
  FEDIFY_USER_ID=$(echo "$RESOLVE_RAW" | jq -r '.object.id // empty' 2>/dev/null || true)
  if [ -n "$FEDIFY_USER_ID" ]; then
    break
  fi
  echo "  Retrying in 5s..."
  sleep 5
done

if [ -z "$FEDIFY_USER_ID" ]; then
  echo "✗ Failed to resolve Fedify user via ap/show — WebFinger/HTTPS discovery failed"
  exit 1
fi
echo "  Fedify user resolved: $FEDIFY_USER_ID"

echo "→ Creating follow relationship (testuser follows Fedify account)..."
echo "  Fedify user ID in Sharkey: $FEDIFY_USER_ID"
FOLLOW_RAW=$(curl -s -X POST "$SHARKEY_URL/api/following/create" \
  -H "Content-Type: application/json" \
  -d "{
    \"i\": \"$TEST_TOKEN\",
    \"userId\": \"$FEDIFY_USER_ID\"
  }" 2>&1) || true
echo "  follow response: ${FOLLOW_RAW:0:200}"

echo "→ Writing test env..."
cat > test/smoke/.env.test <<EOF
SERVER_BASE_URL=http://localhost:3000
SERVER_INTERNAL_HOST=sharkey
SERVER_ACCESS_TOKEN=$TOKEN
HARNESS_BASE_URL=http://localhost:3001
HARNESS_ORIGIN=https://fedify-harness
EOF

echo "✓ Provisioning complete (token: ${TOKEN:0:8}...)"
