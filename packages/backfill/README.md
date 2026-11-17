@fedify/backfill: ActivityPub backfill for Fedify
=================================================

[![npm][npm badge]][npm]
[![JSR][JSR badge]][JSR]
[![Follow @fedify@hackers.pub][@fedify@hackers.pub badge]][@fedify@hackers.pub]

*This package is available since Fedify 2.3.0.*

This package provides ActivityPub conversation backfill support for the
[Fedify] ecosystem.  It can retrieve post-like objects from a seed object's
context collection, following the direct [FEP-f228] path where the
context dereferences to a `Collection`, `OrderedCollection`, `CollectionPage`,
or `OrderedCollectionPage`. Use `backfill()` for posts or
`backfillActivities()` for original conversation activities. The post API can
also use an opt-in reply-tree strategy to walk `inReplyTo` ancestors and
`replies` descendants when context collections
are unavailable or incomplete.

[npm badge]: https://img.shields.io/npm/v/@fedify/backfill?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/backfill
[JSR badge]: https://jsr.io/badges/@fedify/backfill
[JSR]: https://jsr.io/@fedify/backfill
[@fedify@hackers.pub badge]: https://fedi-badge.deno.dev/@fedify@hackers.pub/followers.svg
[@fedify@hackers.pub]: https://hackers.pub/@fedify
[Fedify]: https://fedify.dev/
[FEP-f228]: https://w3id.org/fep/f228


Installation
------------

~~~~ sh
npm  add     @fedify/backfill
pnpm add     @fedify/backfill
yarn add     @fedify/backfill
bun  add     @fedify/backfill
deno add jsr:@fedify/backfill
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

Context and `replies` collections support inline items and pagination through
`first` and successive `next` links.  A collection page used as the starting
collection also follows `next`.  Pages are loaded as needed, and traversal
stops on repeated page links.  Pagination does not increase reply-tree depth.
If a page cannot be loaded, items already yielded are retained and later
configured strategies can continue unless cancellation or traversal limits
stop them.

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

To extract posts only from supported `Create` activities in a context
collection, enable the `context-activities` strategy:

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

### Reading original activities

*This API is available since Fedify 2.5.0.*

Use `backfillActivities()` when your application needs activities such as
`Create`, `Update`, `Delete`, or `Like` rather than extracted posts:

~~~~ typescript
import { backfillActivities } from "@fedify/backfill";

for await (const item of backfillActivities({ documentLoader }, note, {
  contextSource: "history-first",
  maxItems: 100,
  maxRequests: 200,
})) {
  console.log(item.id, item.object.actorId, item.object.objectId);
}
~~~~

The function returns `BackfillItem<Activity>` independently of the seed's
type. It preserves activities and their object references without requiring
target dereferencing, so a `Delete` can be yielded when its target no longer
resolves. It skips direct posts and yields wrapper activities such as `Add`
intact. Collection order is preserved across pages without sorting; results
are not necessarily latest-first.

Activity IDs are deduplicated independently of post IDs. Anonymous activities
are yielded per occurrence. `maxItems` counts yielded activities, excluding
duplicates and skipped loads. Each item has the activity's `id`,
`strategy: "context-activities"`, `origin: "collection"`, and `depth: 0`.

`BackfillActivityOptions` reuse collection selection and traversal controls:
`contextSource`, `contextDiscovery`, `maxDepth`, `maxItems`, `maxRequests`,
`interval`, and `signal`. Ancestor discovery can locate a collection;
`maxDepth` bounds that search. Activity traversal has no `strategies` or
`output` option and does not yield reply-tree posts. Each call owns its cache
and budget; callers can choose the activity stream directly without first
running post backfill.

Collection discovery is not verified inbox delivery. Applications choose
which activities to apply and must perform their own authorization checks.
Existing `backfill()` calls retain their behavior, including the
`context-activities` strategy that extracts posts from `Create`.

### Discovering collections through ancestors

*This option is available since Fedify 2.5.0.*

Set `contextDiscovery: "ancestors"` to find the nearest ancestor collection
through `inReplyTo` when the seed has no usable collection. `maxDepth` bounds
the search. Combine it with `contextSource: "history-first"` to prefer history
collections on the seed and each ancestor. See the [backfill manual] for an
example and selection rules.

[backfill manual]: https://fedify.dev/manual/backfill#discovering-collections-through-ancestors


Traversal controls
------------------

Both functions use the following traversal controls. Within `backfill()`,
all configured strategies share them:

 -  `maxItems` limits yielded posts for `backfill()` or yielded activities for
    `backfillActivities()`. Duplicates and skipped loads do not count.
 -  `maxRequests` limits calls to `documentLoader`.  Embedded objects and
    collections, including embedded pages, do not count.
 -  `maxDepth` limits reply-tree traversal and ancestor collection discovery,
    and defaults to 10. For `backfillActivities()`, it bounds only ancestor
    discovery. It does not limit context collection items.
 -  `interval` adds a delay between loader requests.  Its callback receives
    the zero-based request index.
 -  `signal` cancels traversal and is forwarded to `documentLoader`.

An `interval` string requires the global `Temporal` API or a polyfill.
`Temporal.DurationLike` objects work without the global API.

Without history selection or ancestor discovery, a missing context or a
context resolving to a non-collection produces no collection items in either
API. Loader failures are skipped unless traversal is aborted. In `backfill()`,
later configured strategies can still run if the collection cannot be loaded,
and can use embedded data even when the request budget is exhausted. Failed
loads consume a request. Configuration errors, such as an invalid `interval`,
still propagate.

Dereferenced documents are cached in memory for one invocation of either
backfill function. Thrown loader errors are not cached; returned `null` values
are cached for that invocation. Applications that need persistent or shared
caching can provide it through the `documentLoader`.

The traversal cache is separate from item caches on vocabulary collection
objects. If your loader returns the same previously traversed collection
instance, its cached items and skipped-load placeholders can survive across
calls. Return a freshly parsed collection when retrying failed item loads
through that collection.
