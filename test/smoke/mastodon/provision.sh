#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f test/smoke/mastodon/docker-compose.yml"

echo "→ Creating test user..."
$COMPOSE exec -T mastodon-web bin/tootctl accounts create \
  testuser --email=test@localhost --confirmed \
  || true  # may already exist on re-run

echo "→ Approving and activating test user..."
$COMPOSE exec -T mastodon-web bin/rails runner - <<'RUBY'
user = Account.find_local('testuser').user
user.update!(approved: true, confirmed_at: Time.now.utc)
user.approve! if user.respond_to?(:approve!)
RUBY

echo "→ Generating API token via Rails..."
# Use a unique marker so we can extract just the token from rails runner
# output, which may include deprecation warnings or other noise on stdout.
RAW=$($COMPOSE exec -T mastodon-web bin/rails runner - <<'RUBY' 2>&1 | tr -d '\r'
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

# Verify token works with a simple API call
echo "→ Verifying token..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/accounts/verify_credentials)
echo "  verify_credentials → HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo "✗ Token verification failed (HTTP $HTTP_CODE)"
  exit 1
fi

echo "→ Pre-registering Fedify remote account in Mastodon..."
# Mastodon's WebFinger resolution hardcodes HTTPS, but our harness is HTTP.
# Insert the remote account directly into Mastodon's database with values
# matching the harness actor dispatcher configuration.
HARNESS_ORIGIN="http://fedify-harness:3001"
$COMPOSE exec -T mastodon-web bin/rails runner - <<RUBY
account = Account.find_or_initialize_by(
  username: 'testuser',
  domain: 'fedify-harness:3001'
)
account.update!(
  protocol: :activitypub,
  uri: '$HARNESS_ORIGIN/users/testuser',
  url: '$HARNESS_ORIGIN/users/testuser',
  inbox_url: '$HARNESS_ORIGIN/users/testuser/inbox',
  shared_inbox_url: '$HARNESS_ORIGIN/inbox',
  outbox_url: '$HARNESS_ORIGIN/users/testuser/outbox',
  followers_url: '$HARNESS_ORIGIN/users/testuser/followers',
  display_name: 'Fedify Smoke Test User',
  note: '',
  actor_type: 'Person'
)
print "REGISTERED=#{account.id}"
RUBY

echo "→ Fetching Fedify actor public key..."
# The harness is already running inside Docker.  Fetch its actor document
# and store the public key so Mastodon can verify HTTP signatures without
# needing WebFinger (which hardcodes HTTPS).
$COMPOSE exec -T mastodon-web bin/rails runner - <<'RUBY'
require 'net/http'
require 'json'

uri = URI('http://fedify-harness:3001/users/testuser')
req = Net::HTTP::Get.new(uri)
req['Accept'] = 'application/activity+json'
res = Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(req) }

unless res.is_a?(Net::HTTPSuccess)
  abort "Failed to fetch actor: HTTP #{res.code}"
end

actor = JSON.parse(res.body)
pem = actor.dig('publicKey', 'publicKeyPem')
abort "No publicKey in actor document" if pem.nil?

account = Account.find_by!(username: 'testuser', domain: 'fedify-harness:3001')
account.update!(public_key: pem)
print "KEY_STORED=#{account.id}"
RUBY

echo "→ Creating follow relationship (Fedify → Mastodon) in DB..."
# Ensure the Fedify account follows the Mastodon account in the DB.
# This guarantees that when Mastodon posts a status, it will deliver
# to the Fedify inbox via the followers path (StatusReachFinder).
$COMPOSE exec -T mastodon-web bin/rails runner - <<'RUBY'
fedify_account = Account.find_by!(username: 'testuser', domain: 'fedify-harness:3001')
local_account = Account.find_local('testuser')
follow = Follow.find_or_create_by!(account: fedify_account, target_account: local_account)
print "FOLLOW=#{follow.id}"
RUBY

echo "→ Writing test env..."
cat > test/smoke/.env.test <<EOF
SERVER_BASE_URL=http://localhost:3000
SERVER_INTERNAL_HOST=mastodon:3000
SERVER_ACCESS_TOKEN=$TOKEN
HARNESS_BASE_URL=http://localhost:3001
HARNESS_ORIGIN=http://fedify-harness:3001
EOF

echo "✓ Provisioning complete (token: ${TOKEN:0:8}...)"
