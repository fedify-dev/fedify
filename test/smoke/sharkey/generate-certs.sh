#!/usr/bin/env bash
# Generate a self-signed CA and leaf certificates for strict-mode smoke tests.
# Usage: bash generate-certs.sh [output-dir]
#
# Output directory defaults to .certs/ (relative to this script).
# The CA is ephemeral — generated fresh each run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/.certs}"
mkdir -p "$OUT"

HOSTS=(fedify-harness sharkey)

echo "→ Generating CA key + certificate..."
openssl genrsa -out "$OUT/ca.key" 2048 2>/dev/null
openssl req -x509 -new -nodes \
  -key "$OUT/ca.key" \
  -sha256 -days 1 \
  -subj "/CN=Smoke Test CA" \
  -out "$OUT/ca.crt" 2>/dev/null

for HOST in "${HOSTS[@]}"; do
  echo "→ Generating certificate for $HOST..."
  openssl genrsa -out "$OUT/$HOST.key" 2048 2>/dev/null
  openssl req -new \
    -key "$OUT/$HOST.key" \
    -subj "/CN=$HOST" \
    -out "$OUT/$HOST.csr" 2>/dev/null

  # Create a SAN extension config so the cert is valid for the hostname
  cat > "$OUT/$HOST.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
subjectAltName=DNS:$HOST,DNS:localhost
EOF

  openssl x509 -req \
    -in "$OUT/$HOST.csr" \
    -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial \
    -days 1 -sha256 \
    -extfile "$OUT/$HOST.ext" \
    -out "$OUT/$HOST.crt" 2>/dev/null

  rm -f "$OUT/$HOST.csr" "$OUT/$HOST.ext"
done

rm -f "$OUT/ca.srl"

echo "✓ Certificates written to $OUT/"
ls -la "$OUT"
