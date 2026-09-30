Tootik v0.25.4 actor capture
============================

This fixture records Fedify's verification of a tootik actor captured for
[#1097]. It was captured
from the official Linux amd64 binary for tootik v0.25.4, whose tag points to
commit 5ce4b7fe074d7c385808be387ffcda7040842a19. The unmodified binary created
its default portable `Application` actor in a fresh SQLite database.

*actor.body* is the exact HTTP response body. *actor.json* contains the same
JSON values and member order, with whitespace formatted for repository checks.
*metadata.json* records the binary and response hashes, capture URL/time,
context snapshots, and the Fedify commit used for the baseline verification. No
private keys or database files are included.

The server listened only on loopback. HTTPS requests used a self-signed
certificate trusted explicitly by curl, with `--connect-to` routing the
`tootik.example` authority to the local listener. This check does not establish
public federation or acceptance of Fedify output by tootik.

The three remote contexts declared by the actor were fetched with
`Accept: application/ld+json`. Their parsed JSON values matched the existing
`@fedify/fixture` snapshots listed in *metadata.json*, so the offline tests
reuse those snapshots.

[#1097]: https://github.com/fedify-dev/fedify/issues/1097


Baseline result
---------------

At Fedify commit 3d507d94631110b066056a16618b907a75e8e7ff:

 -  `verifyProof()` accepted the original `eddsa-jcs-2022` proof and resolved
    its `did:key` verification method without fetching a key document.
 -  Changing `preferredUsername` caused proof verification to fail.
 -  The raw actor contained `gateways: ["https://tootik.example"]`, but
    `Application.fromJsonLd()` decoded an empty gateway list. None of the
    declared contexts maps `gateways` to
    `https://w3id.org/fep/ef61/gateways`.
 -  `verifyPortableObjectProof()` rejected the original actor with
    `{ verified: false, reason: { type: "invalidGateways" } }`.

The regression tests in *src/sig/portable-interop.test.ts* now require the
unchanged captured actor to pass `verifyPortableObjectProof()` and expose
`https://tootik.example/` in its decoded gateway list. Fedify accepts the
otherwise unmapped `gateways` term on this portable actor because its
`eddsa-jcs-2022` proof signs the original JSON, including that list. The actor
has not been repaired or re-signed.

This fixture covers actor parsing and proof verification. It does not contain
an incoming HTTP Signature or an activity captured from tootik, and does not
establish acceptance of Fedify output by tootik, Mitra, or Mastodon.


Capture procedure
-----------------

Run the following on Linux amd64. Each fresh database produces new public
keys and a new proof, so its response hash will differ from this fixture.

~~~~ bash
capture_dir=$(mktemp -d)
cd "$capture_dir"
curl --fail --location --output tootik \
  https://github.com/dimkr/tootik/releases/download/v0.25.4/tootik-amd64
chmod u+x tootik
./tootik -version
sha256sum tootik

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -nodes -keyout tls-key.pem -out tls-cert.pem -days 2 \
  -subj /CN=tootik.example -addext subjectAltName=DNS:tootik.example

./tootik -domain tootik.example -addr 127.0.0.1:18443 \
  -gemaddr 127.0.0.1:11965 -db db.sqlite3 \
  -cert tls-cert.pem -key tls-key.pem \
  -gemcert tls-cert.pem -gemkey tls-key.pem >server.log 2>&1 &
tootik_pid=$!
trap 'kill "$tootik_pid" 2>/dev/null; wait "$tootik_pid" 2>/dev/null' EXIT

curl --fail --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 \
  --noproxy '*' --cacert tls-cert.pem \
  --connect-to tootik.example:443:127.0.0.1:18443 \
  -H 'Accept: application/activity+json' \
  --output actor-alias.json https://tootik.example/actor
actor_url=$(python3 -c 'import json; print(json.load(open("actor-alias.json"))["id"])')
curl --fail --max-time 5 --noproxy '*' --cacert tls-cert.pem \
  --connect-to tootik.example:443:127.0.0.1:18443 \
  -H 'Accept: application/activity+json' \
  --dump-header actor.headers --output actor.body "$actor_url"
date -u
sha256sum actor.body
~~~~

Use a domain without an explicit port in `-domain`. In an earlier capture
with `-domain tootik.example:18443`, tootik emitted an HTTPS proof verification
method instead of a `did:key` method. Its gateway URL regular expression does
not recognize an authority containing a port. Fedify rejected that document
with `unsupportedVerificationMethod`. The fixture uses
`-domain tootik.example`, which produced a `did:key` verification method.

Replay the recorded fixture from the Fedify repository root with:

~~~~ bash
mise run test:deno packages/fedify/src/sig/portable-interop.test.ts
~~~~
