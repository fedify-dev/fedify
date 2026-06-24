---
description: >-
  Reconstruct ActivityPub conversations from FEP-f228 context collections or
  reply relationships using the @fedify/backfill package.
---

Conversation backfill
=====================

*This API is available since Fedify 2.3.0.*

Fedify provides the *@fedify/backfill* package for reconstructing ActivityPub
conversations that may be incomplete on the local server.  It can retrieve
post-like objects from [FEP-f228] context collections and optionally crawl
`inReplyTo` ancestors and `replies` descendants.

[FEP-f228]: https://w3id.org/fep/f228


Installation
------------

::: code-group

~~~~ sh [Deno]
deno add jsr:@fedify/backfill
~~~~

~~~~ sh [npm]
npm add @fedify/backfill
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/backfill
~~~~

~~~~ sh [Yarn]
yarn add @fedify/backfill
~~~~

~~~~ sh [Bun]
bun add @fedify/backfill
~~~~

:::


Backfilling a conversation
--------------------------

The `backfill()` function accepts a backfill context, a seed object, and
traversal options.  The context supplies a `documentLoader` for dereferencing
context collections, collection items, reply targets, and replies collections:

~~~~ typescript twoslash
import { backfill, type BackfillDocumentLoader } from "@fedify/backfill";
import { lookupObject, Note } from "@fedify/vocab";

declare const note: Note;
// ---cut-before---
const documentLoader: BackfillDocumentLoader = (iri, options) =>
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

The seed object itself is not yielded.  If the same object appears in a
discovered collection, it is skipped by ID.

By default, `backfill()` uses the `"context-auto"` strategy.  It expects the
seed's `context` to dereference to a `Collection`, `OrderedCollection`,
`CollectionPage`, or `OrderedCollectionPage`.  Ordinary post-like items are
yielded directly, while supported `Create` activities are unwrapped and their
objects are yielded.

If the seed has no context, or its context resolves to a non-collection,
context strategies yield nothing.


Strategies
----------

Strategies run in the configured order.  They share request and item budgets,
abort state, document caching, and object ID deduplication.  If multiple
strategies discover the same object, the first one keeps its `BackfillItem`
metadata.

`"context-auto"`
:   Handles both direct post-like objects and supported `Create` activities
    from a context collection.  This is the default strategy.

`"context-objects"`
:   Accepts only post-like objects contained directly in a context collection:

    ~~~~ typescript twoslash
    import { backfill, type BackfillContext } from "@fedify/backfill";
    import { Note } from "@fedify/vocab";

    declare const context: BackfillContext;
    declare const note: Note;
    // ---cut-before---
    for await (
      const item of backfill(context, note, {
        strategies: ["context-objects"],
      })
    ) {
      console.log(item.object);
    }
    ~~~~

`"context-activities"`
:   Accepts supported activities from a context collection.  It currently
    supports `Create` and yields the activity's object rather than the activity
    itself:

    ~~~~ typescript twoslash
    import { backfill, type BackfillContext } from "@fedify/backfill";
    import { Note } from "@fedify/vocab";

    declare const context: BackfillContext;
    declare const note: Note;
    // ---cut-before---
    for await (
      const item of backfill(context, note, {
        strategies: ["context-activities"],
      })
    ) {
      console.log(item.object);
    }
    ~~~~

`"reply-tree"`
:   Walks `inReplyTo` ancestors and `replies` descendants.  It yields
    post-like objects only and does not unwrap Activity objects.  This strategy
    is opt-in because it can require substantially more network requests than
    a context collection.

For hybrid coverage, run the FEP-f228 path first and use reply-tree traversal
after it:

~~~~ typescript twoslash
import { backfill, type BackfillContext } from "@fedify/backfill";
import { Note } from "@fedify/vocab";

declare const context: BackfillContext;
declare const note: Note;
// ---cut-before---
for await (
  const item of backfill(context, note, {
    strategies: ["context-auto", "reply-tree"],
    maxDepth: 4,
  })
) {
  console.log(item.origin, item.depth, item.object);
}
~~~~


Traversal controls
------------------

`maxItems`
:   Limits the number of yielded objects.  Skipped duplicates do not count.

`maxRequests`
:   Limits calls to `documentLoader`.  Embedded objects and collections do not
    count as requests.

`maxDepth`
:   Limits reply-tree traversal and defaults to 10.  Immediate parents and
    direct replies have depth 1; their next-level parents or replies have depth
    2, and so on.  Context collection items have depth 0 and are not limited by
    this option.

`interval`
:   Adds a delay between `documentLoader` requests.  A callback receives the
    zero-based request index.  String durations require the global `Temporal`
    API or a polyfill; `Temporal.DurationLike` objects work without the global
    API.

`signal`
:   Cancels traversal before requests and yields.  The signal is also passed to
    `documentLoader`.


Caching and failures
--------------------

Dereferenced documents are cached in memory for one `backfill()` traversal.
Applications that need persistent or shared caching can implement it in the
provided `documentLoader`.

Failed external dereferences are skipped so other conversation items can still
be discovered.  Failed loads are not retained in the traversal cache, allowing
the same IRI to be retried if another traversal path reaches it.  Aborting the
provided signal stops traversal instead of skipping the request.
