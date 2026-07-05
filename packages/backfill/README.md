<!-- deno-fmt-ignore-file -->

@fedify/backfill: ActivityPub backfill for Fedify
=================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

*This package is available since Fedify 2.3.0.*

This package provides ActivityPub conversation backfill support for the
[Fedify] ecosystem.  It can retrieve post-like objects from a seed object's
context collection, following the direct [FEP-f228] path where the
context dereferences to a `Collection`, `OrderedCollection`, `CollectionPage`,
or `OrderedCollectionPage`.  It can also use an opt-in reply-tree strategy to
walk `inReplyTo` ancestors and `replies` descendants when context collections
are unavailable or incomplete.

[JSR badge]: https://jsr.io/badges/@fedify/backfill
[JSR]: https://jsr.io/@fedify/backfill
[npm badge]: https://img.shields.io/npm/v/@fedify/backfill?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/backfill
[@fedify@hackers.pub badge]: https://fedi-badge.deno.dev/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[FEP-f228]: https://w3id.org/fep/f228


Installation
------------

~~~~ sh
deno add jsr:@fedify/backfill
npm  add     @fedify/backfill
pnpm add     @fedify/backfill
yarn add     @fedify/backfill
bun  add     @fedify/backfill
~~~~


Usage
-----

The `backfill()` function accepts a backfill context, a seed object, and
traversal options:

~~~~ typescript
import { backfill } from "@fedify/backfill";
import { lookupObject } from "@fedify/vocab";

const documentLoader = (iri: URL, options?: { signal?: AbortSignal }) =>
  lookupObject(iri, { signal: options?.signal });

for await (
  const item of backfill({ documentLoader }, note, {
    maxItems: 20,
    maxRequests: 50,
  })
) {
  console.log(item.id?.href);
}
~~~~

The seed object itself is not yielded.  If it appears in the discovered
collection, it is skipped by ID.

Configured strategies run in order.  They share `maxItems`, `maxRequests`,
abort state, and object ID deduplication; if two strategies discover the same
object, the first strategy keeps its `BackfillItem` metadata.

By default, `backfill()` uses the `context-auto` strategy.  In this mode,
collection items are treated as backfillable objects by default.  If an item is
recognized as a supported `Create` activity, `backfill()` extracts the
activity's object instead.

To accept only post-like objects directly contained in the context collection,
use the `context-objects` strategy:

~~~~ typescript
for await (
  const item of backfill({ documentLoader }, note, {
    strategies: ["context-objects"],
  })
) {
  console.log(item.object);
}
~~~~

To read only FEP-f228 activity collections, enable the `context-activities`
strategy:

~~~~ typescript
for await (
  const item of backfill({ documentLoader }, note, {
    strategies: ["context-activities"],
  })
) {
  console.log(item.object);
}
~~~~

The `context-activities` strategy currently supports `Create` activities and
yields the activity's object, not the activity itself.

To combine the FEP-f228 context collection path with traditional reply-tree
crawling, add the `reply-tree` strategy after `context-auto`:

~~~~ typescript
for await (
  const item of backfill({ documentLoader }, note, {
    strategies: ["context-auto", "reply-tree"],
    maxDepth: 4,
  })
) {
  console.log(item.origin, item.depth, item.object);
}
~~~~

The `reply-tree` strategy walks `inReplyTo` ancestors and `replies`
descendants.  It yields discovered post-like objects only; it does not extract
objects from Activity wrappers.  Immediate parents and direct replies have
depth 1, their next-level parents or replies have depth 2, and so on.
Reply-tree traversal defaults to a maximum depth of 10; set `maxDepth` to use a
different limit.


Traversal controls
------------------

All configured strategies share the same traversal controls:

 -  `maxItems` limits the number of yielded objects.  Skipped duplicates do
    not count.
 -  `maxRequests` limits calls to `documentLoader`.  Embedded objects and
    collections do not count.
 -  `maxDepth` limits reply-tree traversal and defaults to 10.  It does not
    limit context collection items.
 -  `interval` adds a delay between loader requests.  Its callback receives
    the zero-based request index.
 -  `signal` cancels traversal and is forwarded to `documentLoader`.

An `interval` string requires the global `Temporal` API or a polyfill.
`Temporal.DurationLike` objects work without the global API.

If the seed has no context, or its context resolves to a non-collection,
context strategies yield nothing.  Loader failures are skipped unless
traversal is aborted.

Dereferenced documents are cached in memory for one `backfill()` traversal.
Applications that need persistent or shared caching can provide it through
the `documentLoader`.
