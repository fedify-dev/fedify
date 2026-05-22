<!-- deno-fmt-ignore-file -->

@fedify/backfill: ActivityPub backfill for Fedify
=================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Follow @fedify@hollo.social][@fedify@hollo.social badge]][@fedify@hollo.social]

*This package is available since Fedify 2.3.0.*

This package provides the scaffold for ActivityPub backfill support in the
[Fedify] ecosystem.  It is intended to host APIs for retrieving and processing
historical federated content, but the implementation has not been added yet.

[JSR badge]: https://jsr.io/badges/@fedify/backfill
[JSR]: https://jsr.io/@fedify/backfill
[npm badge]: https://img.shields.io/npm/v/@fedify/backfill?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/backfill
[@fedify@hollo.social badge]: https://fedi-badge.deno.dev/@fedify@hollo.social/followers.svg
[@fedify@hollo.social]: https://hollo.social/@fedify
[Fedify]: https://fedify.dev/


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


Status
------

The package structure and publishing metadata are in place.  Public runtime
APIs will be added in follow-up changes once the backfill workflow and data
model are finalized.
