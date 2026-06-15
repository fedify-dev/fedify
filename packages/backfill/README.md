<!-- deno-fmt-ignore-file -->

@fedify/backfill: ActivityPub backfill for Fedify
=================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 2.3.0.*

This package provides ActivityPub conversation backfill support for the
[Fedify] ecosystem.  It can retrieve post-like objects from a seed object's
context collection, following the direct FEP-f228-style path where the
context dereferences to a `Collection`, `OrderedCollection`, `CollectionPage`,
or `OrderedCollectionPage`.

[JSR badge]: https://jsr.io/badges/@fedify/backfill
[JSR]: https://jsr.io/@fedify/backfill
[npm badge]: https://img.shields.io/npm/v/@fedify/backfill?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/backfill
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/


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

By default, `backfill()` uses the `context-auto` strategy.  In this mode,
collection items are treated as backfillable objects by default.  If an item is
recognized as a supported `Create` activity, `backfill()` extracts the
activity's object instead.

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
