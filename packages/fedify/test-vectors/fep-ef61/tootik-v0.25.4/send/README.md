Fedify to tootik portable create capture
========================================

This fixture records native `signObject()` and `Context.sendActivity()` output
received by the unmodified official tootik v0.25.4 binary. The source commit
and binary SHA-256 match the [parent fixture]. It complements the
[tootik to Fedify capture]. Mastodon was not tested.

The sender used a signed portable `Person`, a separately signed public `Note`,
and a signed `Create` embedding that `Note`. Signing used the default JSON-LD
contexts. Sending used `normalizeExistingProofs: true`, as required for
locally pre-signed activities. No vocabulary subclass, gateway rewrite, or
re-signing of the outgoing wire document was used.

Tootik initially returned HTTP 401 with `actor is too young`. Fedify's retry
delivered the same body and received HTTP 202. The recorded SQLite query then
found the exact note ID, author, and content in tootik's `notes` table. This
establishes asynchronous processing, beyond acceptance into an inbox queue.
A separate request changing the embedded note's content after signing returned
HTTP 401.

Tootik authenticates proof-bearing activities through their Object Integrity
Proofs and skips HTTP Signature verification on that path. The accepted
request also carried a Cavage RSA gateway HTTP Signature, which the offline
test verifies independently at the capture time. That check does not imply
that tootik enforced the HTTP Signature during this delivery.

The *.body* files preserve the outgoing request and served sender actor bytes.
The recipient actor is a compact JSON copy of the tootik response.
*raw-bodies.json* holds these bodies as JSON strings for runtime-neutral test
imports; regenerate it with the bodies and their hashes when recapturing.
The request/response records include the original URL, headers, receipt time,
and statuses. *processed-note.json* records the database query and its result.
*metadata.json* records provenance and body hashes. Private keys, databases,
and TLS certificates are excluded.

[parent fixture]: ../README.md
[tootik to Fedify capture]: ../follow/README.md


Capture procedure
-----------------

Start with the pinned binary, registered recipient, TLS certificates, and
Fedify receiver described in the [tootik to Fedify capture]. Preserve the
receiver's ordinary actor and inbox routes. Add a route serving the exact
signed sender `Person` at its compatible portable actor URL.

The sender gateway must have no explicit port: tootik v0.25.4's portable
gateway identifier matcher does not recognize an actor URL containing a port.
The capture used `https://fedify.example`, with a TLS passthrough proxy on a
dedicated Podman network. The proxy was named `fedify.example` and forwarded
TCP ports 443 and 18444 to `host.containers.internal:18444`. The receiver bound
to `0.0.0.0:18444` for that route. Tootik kept its original database, binary,
configuration, and certificates. This was transport configuration, not a
modification to either implementation.

Generate a fresh Ed25519 identity key and separate gateway signing keys. Use
`exportDidKey()` for the identity DID, and `toCompatibleEf61Id()` for the
sender's actor, inbox, outbox, activity, and note identifiers under
`https://fedify.example/.well-known/apgateway/`. Publish the gateway keys in
the actor's `publicKey` and `assertionMethods`. Sign the actor, note, and
activity with the identity key and its `did:key` verification method. The
public note's `tos` include the full ActivityStreams Public URI and the
tootik recipient's actor URL.

Send the activity through the native API:

~~~~ typescript
await ctx.sendActivity(gatewayKeys, recipient, signedCreate, {
  normalizeExistingProofs: true,
});
~~~~

Capture each HTTP attempt before transmission. For the local test, connect
to `https://localhost:18443` while retaining the signed request's original
`https://tootik.example` URL and `Host` value in the capture. Trust the local
CA explicitly. Keep the actor server available while tootik resolves the
sender and processes its queue. Use the repository's context snapshots for
signing and retain the original raw documents for verification.

After HTTP 202, query tootik's SQLite database for the exact generated note
ID, and verify its author and content. Send a second request changing only
the embedded content without updating either proof, and record its rejection.
Fresh keys and proof timestamps make repeated capture bytes differ.

Replay the recorded fixture with:

~~~~ bash
mise run test:deno packages/fedify/src/sig/tootik-send-interop.test.ts
~~~~
