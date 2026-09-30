Tootik to Fedify follow capture
===============================

This fixture records a portable `Person` created by the unmodified official
tootik v0.25.4 Linux amd64 binary, followed by its live `Follow` delivery to a
Fedify HTTPS inbox. The tag points to commit
`5ce4b7fe074d7c385808be387ffcda7040842a19`; the binary SHA-256 is
`c24982af1a58cf8d4a8ae1a66dae7252d90bb1310c31d297ddc4b040d790f0c2`.
The binary download and actor-only capture are documented in the
[parent fixture].

*request.body* is the exact delivered body. *request.json* records the method,
URL, headers, and capture time. *actor.body* is the exact actor response fetched
while resolving the HTTP signing key. *actor.json* contains the same JSON
values with repository formatting. *metadata.json* records their hashes and
the live result. *raw-bodies.json* contains the same two bodies as JSON strings
for runtime-neutral test imports; regenerate it together with the *.body*
files and their hashes when recapturing. Private keys, client certificates,
and databases are excluded.

Fedify independently verified the Cavage RSA HTTP Signature with the portable
actor's `#main-key`, using the normal current-time freshness check. Its inbox
then returned HTTP 202 and dispatched the original `Follow` to its listener.
The inbox authenticated the original `eddsa-jcs-2022` Object Integrity Proof;
this path skips HTTP Signature verification, so HTTP 202 alone would not
establish that the HTTP Signature was valid. Neither the actor nor the activity
was repaired or re-signed by Fedify.

Offline tests in *src/sig/tootik-request-interop.test.ts* replay the captured
request with `currentTime` set to its capture time. They preserve the normal
freshness window instead of treating an old request as a new live delivery.
This result covers tootik to Fedify only. Acceptance of Fedify output by tootik,
Mitra interoperability, and Mastodon compatibility remain separate work.

[parent fixture]: ../README.md


Capture procedure
-----------------

The capture used a fresh SQLite database and a TLS client certificate with
common name `alice`. The client registered a portable user through tootik's
Gemini frontend, supplying `generate` rather than an imported signing key.
It then resolved the Fedify user through WebFinger and followed that user.
All signing and delivery were performed by the official tootik binary.

Create a local CA and a server leaf certificate with SANs for `tootik.example`,
`fedify.example`, and `localhost`. The CA must have `CA:TRUE`; the leaf must
have `CA:FALSE`, `digitalSignature` key usage, and `serverAuth` extended key
usage. Use the leaf followed by the CA as *tls-cert.pem*, its private key as
*tls-key.pem*, and a separate client certificate/key as *client-cert.pem* and
*client-key.pem*. Trust the CA explicitly in the Gemini client and both HTTPS
clients. These files stay outside the repository.

Run a Fedify HTTPS receiver at `127.0.0.1:18444` with origin
`https://fedify.example:18444`. Serve an ordinary `Person` at
*/users/alice*, its inbox at */users/alice/inbox*, and a WebFinger self link
for `acct:alice@fedify.example:18444`. Register a `Follow` listener and record
its activity ID and actor ID. Before passing each original POST to
`federation.fetch()`, separately call `verifyRequestDetailed()` on a clone and
record its result. Capture the exact body, request headers, URL, receipt time,
inbox response, and actor document fetched by the key loader.

The receiver's actor loader connected to `https://localhost:18443` while
retaining tootik's original document URL. Its TLS client trusted the local CA;
it did not disable certificate verification. Context loading reused the
snapshots described in the parent fixture.

Run tootik in Podman with the official binary mounted read-only. This uses
container-specific host entries instead of changing host DNS. The capture
used `169.254.1.2` for the host-facing address in its rootless container
network; replace that address if the local network uses another address.

~~~~ bash
capture_dir=/tmp/fedify-1097-wire-live
binary_path=/tmp/fedify-1097-tootik-v0.25.4/tootik-amd64
mkdir -p "$capture_dir/data"
cat > "$capture_dir/signing.json" <<'JSON'
{"RFC9421Threshold":1,"Ed25519Threshold":1,"MLDSA44Threshold":1}
JSON
podman run --name fedify-1097-tootik \
  --network pasta:--map-host-loopback,169.254.1.2 \
  --add-host fedify.example:169.254.1.2 \
  --add-host tootik.example:127.0.0.1 \
  -p 127.0.0.1:18443:443 -p 127.0.0.1:11965:1965 \
  -v "$capture_dir:/capture" \
  -v "$binary_path:/usr/local/bin/tootik:ro" \
  -e SSL_CERT_FILE=/capture/tls-cert.pem \
  docker.io/library/alpine:3.23 \
  tootik -domain tootik.example -db /capture/data/db.sqlite3 \
  -cfg /capture/signing.json -cert /capture/tls-cert.pem \
  -key /capture/tls-key.pem -gemcert /capture/tls-cert.pem \
  -gemkey /capture/tls-key.pem -loglevel -4
~~~~

The pinned binary defaults to HTTPS port 443 and Gemini port 1965, as verified
with `tootik -help`. The three threshold values suppress random HTTP signature
algorithm probes.
The Fedify recipient did not advertise alternative signature capabilities,
so tootik sent a Cavage RSA signature covering `(request-target)`, `host`,
`date`, `content-type`, and `digest`.

From a Gemini client using the `alice` client certificate, connect to
`127.0.0.1:11965` with TLS server name `tootik.example` and request these URLs
in order:

~~~~ text
gemini://tootik.example/users/register?generate
gemini://tootik.example/users/resolve?alice%40fedify.example%3A18444
gemini://tootik.example/users/follow/fedify.example:18444/users/alice
~~~~

Registration and resolution return redirects. The final request queues the
proof-signed `Follow`; the running daemon delivers it to
`https://fedify.example:18444/users/alice/inbox`. Verify both the independent
HTTP signature result and the inbox listener record. Fresh registrations
generate new keys, IDs, proofs, and hashes, so a repeated capture will differ
from these files.

Replay the recorded fixture from the repository root with:

~~~~ bash
mise run test:deno packages/fedify/src/sig/tootik-request-interop.test.ts
~~~~
