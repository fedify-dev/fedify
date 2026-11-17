---
links:
  '#1339': https://github.com/fedify-dev/fedify/issues/1339
  '#1347': https://github.com/fedify-dev/fedify/pull/1347
  '#1380': https://github.com/fedify-dev/fedify/issues/1380
  '#1381': https://github.com/fedify-dev/fedify/issues/1381
  '#1388': https://github.com/fedify-dev/fedify/pull/1388
  '#1389': https://github.com/fedify-dev/fedify/issues/1389
  '#1390': https://github.com/fedify-dev/fedify/pull/1390
  '#1391': https://github.com/fedify-dev/fedify/pull/1391
  '#1392': https://github.com/fedify-dev/fedify/pull/1392
  '#1405': https://github.com/fedify-dev/fedify/issues/1405
  '#1406': https://github.com/fedify-dev/fedify/issues/1406
  '#1411': https://github.com/fedify-dev/fedify/pull/1411
  '#1413': https://github.com/fedify-dev/fedify/pull/1413
  '#1421': https://github.com/fedify-dev/fedify/issues/1421
  '#1422': https://github.com/fedify-dev/fedify/pull/1422
  '#554': https://github.com/fedify-dev/fedify/issues/554
  '#664': https://github.com/fedify-dev/fedify/issues/664
---
 -  Fixed `Context.sendActivity()` and `InboxContext.forwardActivity()` giving
    up on the remaining deliveries when one recipient failed.  The immediate
    delivery paths now wait for every delivery they have already started before
    propagating the error, so the remaining recipients are still reached on
    runtimes such as Cloudflare Workers, which may terminate an isolate once
    the error response is returned.  This applies both to `immediate: true` and
    to federations without an outbox queue.
    [[#1380], [#1388]]
 -  Fixed `CryptoKey` and `CryptoKeyPair` values obtained from `node:crypto`
    being rejected by `ActorKeyPairsDispatcher`, `SharedInboxKeyDispatcher`,
    `SenderKeyPair`, `signRequest()`, `createProof()`, `signObject()`,
    `createSignature()`, `signJsonLd()`, `exportJwk()`, and the authenticated
    document loader APIs when `@types/node` 24.7.0 or later is installed.
    Those APIs now accept a structural key type that both Node.js and
    DOM/Web Worker keys satisfy, while the keys returned by Fedify keep the
    ambient `CryptoKey` types.  `SenderKeyPair` and
    `SharedInboxKeyDispatcher` take a type parameter that defaults to
    `CryptoKey`, so code that reads a key pair or calls a dispatcher keeps the
    narrower type.
    [[#554], [#1391]]
 -  Fixed Linked Data Signature verification rejecting documents with unmapped
    extension properties, such as an undefined `quoteUri`, that the sender's
    JSON-LD processor discards.  Discarded properties are not authenticated by
    the signature.  Outbound signing still rejects lossy input, and verification
    continues to reject relative IRIs and unsafe graph structures.
    [[#1405], [#1411]]
 -  Fixed Linked Data Signatures being emitted with a JSON-LD context that no
    longer resolves.  The attached `signature` object now uses
    `https://w3id.org/security/v1` instead of
    `https://w3id.org/identity/v1`, which redirects to an unreachable host.
    Documents signed through `signJsonLd()` or `attachSignature()` whose
    context does not define `signature` now also get a minimal inline
    definition of that term, so the signed document remains valid JSON-LD.
    Documents that already carry a `proof` are left unchanged, since a new
    context definition would invalidate the proof.  Activities queued for
    fanout before the upgrade also keep their original proof-covered JSON when
    replayed.  Incoming signatures that still use `identity/v1` continue to
    verify.  [[#664]]
 -  Fixed automatic queue worker startup failures becoming unhandled promise
    rejections.  When `manuallyStartQueue` was left `false` and a `MessageQueue`
    implementation could not start listening, such as `WorkersMessageQueue` on
    Cloudflare Workers whose `listen()` throws a `TypeError`, the rejection from
    the implicit startup in inbox handling and in `Context.sendActivity()` was
    discarded.  It is now logged as a warning once per `Federation` instance,
    and a synchronous throw from one queue no longer prevents the remaining
    queues from starting.  The failed worker is not retried, so restart the
    process after fixing the queue.  `Federation.startQueue()` still rejects so
    callers that start workers deliberately see the error, and Cloudflare
    Workers deployments should set `manuallyStartQueue: true` to avoid the
    warning entirely.
    [[#1381], [#1390]]
 -  Fixed inbox handling that treated valid date-times without seconds, such
    as `2024-01-01T10:00Z` or `2024-01-01T10:00.5Z`, as permanently malformed.
    Activity Streams 2.0 allows seconds to be omitted, so activities with such
    date-times are no longer rejected or dropped.  Activities whose
    `Question.closed` is a date-like but impossible value, such as
    `2024-02-31T10:00.5Z`, are now treated as malformed instead of being
    accepted with `closed` discarded.
    [[#1339], [#1347] by ChanHaeng Lee\]
 -  Fixed incoming Linked Data Signatures without a `created` field being
    treated as unsigned.  Valid `RsaSignature2017` signatures without that field
    now verify through the JSON-LD APIs and inbox, including queued inbox
    processing, and are forwarded when `skipIfUnsigned` is enabled.
    Malformed signature objects now produce a debug log with
    their property names.  Invalid creator URLs now fail verification without
    throwing an exception.  Outgoing signatures still include `created`.
    [[#1406], [#1413]]
 -  Fixed singleton `attachment` values being serialized as objects in actor,
    object, and collection responses, which caused Mastodon to ignore a single
    profile field.  Served responses and newly generated activity deliveries
    now preserve attachment arrays when the JSON-LD context permits it.
    Documents containing existing proofs or Linked Data signatures are left
    unchanged by the compatibility rewrite.  New normalized deliveries are
    signed over the same JSON used for queueing and transport.
    [[#1421], [#1422], [mastodon/mastodon\#41640]]
 -  Fixed the fanout worker never starting when the `fanout` queue was the only
    configured queue.  `Federation.startQueue()` returned without calling
    `fanoutQueue.listen()`, so fanout messages were enqueued but never
    consumed; the implicit startup triggered by a fanout enqueue silently did
    nothing.  Both paths now start the fanout worker, and deployments that
    configure only `queue: { fanout: ... }` no longer need to add an unused
    `inbox` or `outbox` queue to make fanout delivery work.
    [[#1389], [#1392]]
 -  Limited WebFinger lookups made through federation contexts to 10 seconds
    per lookup.  \[[GHSA-9pmv-w936-hj3f]]
 -  Limited each outgoing activity delivery attempt to 30 seconds, including
    redirects and HTTP signature retries, so a slow remote inbox cannot hold a
    delivery worker indefinitely.  Timed-out attempts follow the configured
    retry schedule.  \[[GHSA-fq5h-gjhp-g75x]]
 -  NodeInfo lookups now stop following a redirect when its target repeats an
    earlier URL in the same chain.  A self-redirect previously opened five
    fetch sessions before hitting the redirect limit; it now stops after the
    first response.  The existing redirect limit still applies to chains
    without cycles.
    [[GHSA-64hq-2hgr-q4pm]]
 -  NodeInfo lookups now time out after 10 seconds by default.  A remote server
    could previously keep `getNodeInfo()` or `Context.lookupNodeInfo()` waiting
    indefinitely by delaying a response.  The limit covers discovery,
    redirects, and the document body as one operation.  Pass a `timeout` value
    in milliseconds to allow more time, or `null` to disable the limit; a
    timed-out lookup returns `undefined`.
    An optional `signal` can cancel the lookup, even with `timeout: null`.
    [[GHSA-64hq-2hgr-q4pm]]
 -  On Node.js, NodeInfo hostname resolution now starts at most two operating
    system DNS lookups at a time.  Other hosts can still resolve when one
    resolver call stalls.  A queued lookup can time out or be cancelled before
    starting, so repeated abandoned NodeInfo requests cannot fill the shared
    libuv thread pool.  An already-running operating system lookup cannot be
    cancelled.
    [[GHSA-64hq-2hgr-q4pm]]

[mastodon/mastodon\#41640]: https://github.com/mastodon/mastodon/issues/41640
[GHSA-9pmv-w936-hj3f]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-9pmv-w936-hj3f
[GHSA-fq5h-gjhp-g75x]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-fq5h-gjhp-g75x
[GHSA-64hq-2hgr-q4pm]: https://github.com/fedify-dev/fedify/security/advisories/GHSA-64hq-2hgr-q4pm
