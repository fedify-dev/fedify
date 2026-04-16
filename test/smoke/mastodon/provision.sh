#!/usr/bin/env bash
# Provision Mastodon for smoke tests (HTTPS + signature verification).
#
#  - Uses WebFinger discovery (ResolveAccountService) instead of DB pre-registration
#  - Writes HTTPS URLs to .env.test
#  - Talks to mastodon-web backend directly (HTTP on port 3000) for API calls
set -euo pipefail

COMPOSE="docker compose -f test/smoke/mastodon/docker-compose.yml"

echo "→ Creating test user..."
$COMPOSE exec -T mastodon-web-backend bin/tootctl accounts create \
  testuser --email=test@localhost --confirmed \
  || true  # may already exist on re-run

echo "→ Approving and activating test user..."
$COMPOSE exec -T mastodon-web-backend bin/rails runner - <<'RUBY'
user = Account.find_local('testuser').user
user.update!(approved: true, confirmed_at: Time.now.utc)
user.approve! if user.respond_to?(:approve!)
RUBY

echo "→ Generating API token via Rails..."
RAW=$($COMPOSE exec -T mastodon-web-backend bin/rails runner - <<'RUBY' 2>&1 | tr -d '\r'
user = Account.find_local('testuser').user
app = Doorkeeper::Application.find_or_create_by!(name: 'smoke-test') do |a|
  a.redirect_uri = 'urn:ietf:wg:oauth:2.0:oob'
  a.scopes = 'read write follow'
end
token = Doorkeeper::AccessToken.find_or_create_for(
  application: app,
  resource_owner: user,
  scopes: Doorkeeper::OAuth::Scopes.from_string('read write follow'),
  expires_in: nil,
  use_refresh_token: false
)
print "SMOKE_TOKEN=#{token.token}"
RUBY
)

TOKEN=$(echo "$RAW" | grep -oP 'SMOKE_TOKEN=\K\S+' | tail -1)

if [ -z "$TOKEN" ]; then
  echo "✗ Failed to generate API token"
  exit 1
fi

# Verify token works — talk directly to the backend (HTTP, port 3000)
echo "→ Verifying token..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/accounts/verify_credentials)
echo "  verify_credentials → HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo "✗ Token verification failed (HTTP $HTTP_CODE)"
  exit 1
fi

echo "→ Resolving Fedify account via WebFinger (ResolveAccountService)..."
# Use Mastodon's built-in account resolution, which performs WebFinger over
# HTTPS to the Caddy-fronted harness.  This validates that the full TLS +
# WebFinger chain works.
$COMPOSE exec -T mastodon-web-backend bin/rails runner - <<'RUBY'
account = ResolveAccountService.new.call('testuser@fedify-harness')
if account.nil?
  abort "✗ ResolveAccountService returned nil — WebFinger discovery failed"
end
print "RESOLVED=#{account.id} (#{account.uri})"
RUBY

echo "→ Creating follow relationship (Fedify → Mastodon) in DB..."
$COMPOSE exec -T mastodon-web-backend bin/rails runner - <<'RUBY'
fedify_account = Account.find_by!(username: 'testuser', domain: 'fedify-harness')
local_account = Account.find_local('testuser')
follow = Follow.find_or_create_by!(account: fedify_account, target_account: local_account)
print "FOLLOW=#{follow.id}"
RUBY

echo "→ Writing test env..."
cat > test/smoke/.env.test <<EOF
SERVER_BASE_URL=http://localhost:3000
SERVER_INTERNAL_HOST=mastodon
SERVER_ACCESS_TOKEN=$TOKEN
HARNESS_BASE_URL=http://localhost:3001
HARNESS_ORIGIN=https://fedify-harness
EOF

echo "✓ Provisioning complete (token: ${TOKEN:0:8}...)"
