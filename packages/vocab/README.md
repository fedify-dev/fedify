<!-- deno-fmt-ignore-file -->

@fedify/vocab: ActivityPub vocabulary for Fedify
================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides a collection of type-safe objects that represent the
[Activity Vocabulary] and vendor-specific extensions for the [Fedify] framework.
It is the core vocabulary library that powers ActivityPub object handling in
Fedify applications.

[JSR badge]: https://jsr.io/badges/@fedify/vocab
[JSR]: https://jsr.io/@fedify/vocab
[npm badge]: https://img.shields.io/npm/v/@fedify/vocab?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/vocab
[Activity Vocabulary]: https://www.w3.org/TR/activitystreams-vocabulary/
[Fedify]: https://fedify.dev/


Features
--------

 -  Type-safe objects for [Activity Vocabulary] types (`Create`, `Note`,
    `Person`, etc.)
 -  Vendor-specific extensions (Mastodon, Misskey, etc.)
 -  JSON-LD serialization and deserialization
 -  Immutable object design with `clone()` method for modifications
 -  Support for looking up remote objects
 -  Actor handle resolution via WebFinger


Installation
------------

~~~~ bash
deno add jsr:@fedify/vocab # Deno
npm add @fedify/vocab # npm
pnpm add @fedify/vocab # pnpm
yarn add @fedify/vocab # Yarn
bun add @fedify/vocab # Bun
~~~~


Usage
-----

### Instantiation

You can instantiate an object by calling the constructor with properties:

~~~~ typescript
import { Create, Note } from "@fedify/vocab";

const create = new Create({
  id: new URL("https://example.com/activities/123"),
  actor: new URL("https://example.com/users/alice"),
  object: new Note({
    id: new URL("https://example.com/notes/456"),
    content: "Hello, world!",
  }),
});
~~~~

### JSON-LD serialization

Deserialize from JSON-LD:

~~~~ typescript
import { Create } from "@fedify/vocab";

const create = await Create.fromJsonLd({
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/activities/123",
  "actor": "https://example.com/users/alice",
  "object": {
    "type": "Note",
    "id": "https://example.com/notes/456",
    "content": "Hello, world!",
  }
});
~~~~

Serialize to JSON-LD:

~~~~ typescript
const jsonLd = await create.toJsonLd();
~~~~

### Immutability

All objects are immutable. Use `clone()` to create modified copies:

~~~~ typescript
import { Note } from "@fedify/vocab";
import { LanguageString } from "@fedify/vocab-runtime";

const noteInEnglish = new Note({
  id: new URL("https://example.com/notes/123"),
  content: new LanguageString("Hello, world!", "en"),
});

const noteInChinese = noteInEnglish.clone({
  content: new LanguageString("你好，世界！", "zh"),
});
~~~~

### Looking up remote objects

~~~~ typescript
import { lookupObject } from "@fedify/vocab";

const object = await lookupObject("https://example.com/users/alice");
~~~~


Documentation
-------------

For comprehensive documentation, please refer to:

 -  [Vocabulary documentation]
 -  [API reference]

[Vocabulary documentation]: https://fedify.dev/manual/vocab
[API reference]: https://jsr.io/@fedify/vocab/doc/~


Related packages
----------------

 -  *@fedify/fedify*: The main Fedify framework
 -  *@fedify/vocab-runtime*: Runtime utilities for vocabulary objects
 -  *@fedify/vocab-tools*: Code generation tools for Activity Vocabulary


License
-------

[MIT License]

[MIT License]: https://github.com/fedify-dev/fedify/blob/main/LICENSE
