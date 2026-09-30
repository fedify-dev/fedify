Fedify to mitra capture
=======================

This fixture records live Fedify to Mitra v5.10.0 interoperability. The
unmodified Mitra image was pinned to
`codeberg.org/silverpill/mitra@sha256:4348ddea1d819f654cd3e6be4e955b3933d1d21807c6a9a8ef64eda4333f1d0a`.
Its version output was `mitra 5.10.0`; tag `v5.10.0` points to source commit
`17340ef09d4a902f301acdcfde094f5778d72f35`.

Fedify's native `Person` registered successfully with Mitra's FEP-ae97
gateway endpoint after gateway serialization changed from root-path URLs to
origins. Registration returned HTTP 201; the previous trailing-slash
representation returned HTTP 400 with `invalid gateway URL`. No actor
subclass or gateway-string rewrite was used in the successful capture.

The registration prerequisite created recipient A using a scratch client, a
fresh invite code, and a fresh Ed25519 identity. Fedify does not supply a
public FEP-ae97 client.
The scratch client submitted the actor to `POST /.well-known/apgateway`,
incorporated the gateway keys returned by Mitra, and submitted a signed actor
`Update` and `Create` to the portable outbox. Registration returned HTTP 201;
both activities returned HTTP 202 and appeared in processed collections.

These setup activities used the public `signObject()` context option with
compact remote contexts and the existing internal
`normalizeOutgoingActivityJsonLd()` helper. With default actor contexts,
registration succeeded but the embedded actor `Update` returned HTTP 400,
`too many embedded objects`. Mitra's limit counts JSON objects recursively,
including inline JSON-LD context maps, and its limit is 20. The
setup workaround is not evidence of a public Fedify client-to-server API.

The subsequent server-to-server test used a distinct Fedify sender B, which
was not registered as a portable account on Mitra. Its native `Person`, `Note`,
and `Create` objects used default `signObject()` contexts and the documented
`normalizeExistingProofs: true` option to `Context.sendActivity()`. Its first
request carried an RFC 9421 RSA HTTP Signature and returned HTTP 202. A
subsequent PostgreSQL query confirmed worker processing by finding the
sender's `Create` in recipient A's inbox. A separate profile query confirmed
that A had a registered portable account and B did not. The embedded note also
had a processed post in Mitra's database. Replacing only the HTTP
signature bytes returned HTTP 401 with `signature verification error`.
This is stronger evidence than HTTP 202 alone, which does not establish
asynchronous processing.

*request.body* and *request.json* preserve the native server-to-server body,
URL, headers, and capture time. *response.json* records the first response.
*actor.body* and *actor.json* record sender B's fetched native actor; the
Mitra-served actor files record recipient A. They retain the key material
needed for offline verification; *raw-bodies.json* and *metadata.json* record
provenance and hashes. *registration-response.json* records the gateway
registration response, *processed-collections.json* records the worker result,
*profiles.json* records the distinct account roles, and *processed-note.json*
records the note and its processed post, while *tampered-response.json* records
signature rejection. The baseline gateway files record the rejected spelling.
Private keys, database files, and registration requests containing invite codes
are excluded.

Offline replay in *src/sig/mitra-send-interop.test.ts* verifies the captured
proofs and HTTP signature with the recorded time. Live processing is supported
by the recorded Mitra response and PostgreSQL rows; offline replay alone
does not reproduce an external server's processing.


Capture environment and procedure
---------------------------------

Mitra ran in Podman with PostgreSQL 16 on a dedicated bridge network. Its
HTTP listener was published at `127.0.0.1:18497`, gateway support was enabled,
and SSRF protection was disabled for this isolated local capture. Recipient
A's setup gateways were `http://127.0.0.1:18497` and
`http://localhost:18498`. Sender B used `https://fedify.example`, reached
through a TLS passthrough proxy on port 443 to the host receiver on port
18444. Mitra's CA store trusted the local CA; TLS verification remained
enabled. The local transport and security settings do not establish public
deployment behavior.

Mitra fetched sender B's actual actor document and queried WebFinger for
`acct:fedifydistinct@fedify.example`. An earlier explicit-port gateway failed
because Mitra derives the WebFinger URL from the gateway hostname without
retaining the port. The successful capture used the portless HTTPS gateway
and the corresponding WebFinger response, rather than bypassing resolution.

To repeat the capture:

1.  Start the pinned Mitra image with a fresh database, gateway support, and
    the local listener described above. Keep its configuration, storage, and
    signing keys outside the repository.
2.  Generate an invite code with
    `podman exec fedify-1097-mitra mitra generate-invite-code`. Create a native
    Fedify recipient A `Person` with portable actor/inbox/outbox IDs, two
    gateways, an Ed25519 DID identity, and an RSA gateway key. Sign the actor
    and register it through Mitra's gateway endpoint with the `X-Invite-Code`
    header.
3.  Add the returned gateway verification methods to the actor, sign its
    `Update`, and submit that activity to its compatible portable outbox.
    Use compact contexts for this setup step because of the object limit.
    Submit the setup `Create` and confirm processing in the outbox.
4.  Create an independent Fedify sender B with new DID and RSA keys. Serve
    its default-context signed `Person` at its HTTPS compatible actor URL,
    together with a WebFinger self link on the same portless gateway. Sign
    its new native `Note` and `Create` with default contexts. Call
    `Context.sendActivity()` with B's RSA gateway key, A's Mitra inbox
    as recipient, and `{ normalizeExistingProofs: true }`. Capture the exact
    outgoing request and response without modifying the body or gateways.
5.  Query Mitra's `activitypub_collection_item` and `activitypub_object`
    tables for the unique portable `Create` ID. Record the collection IDs and
    object type, requiring B's activity in A's inbox. Query `actor_profile`
    to confirm A has a portable account and B does not. Repeat the POST with
    corrupted HTTP signature bytes and record the HTTP 401 response.

Fresh identities produce different keys, IDs, proofs, signatures, and hashes.
The captured test can be replayed from the repository root with:

~~~~ bash
mise run test:deno packages/fedify/src/sig/mitra-send-interop.test.ts
~~~~

This fixture covers Fedify to Mitra only. Mitra to Fedify verification belongs
to a separate capture, and Mastodon interoperability is outside this result.
