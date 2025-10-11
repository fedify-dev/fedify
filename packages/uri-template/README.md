<!-- deno-fmt-ignore-file -->

@fedify/uri-template: RFC 6570 URI Template implementation
===========================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides [RFC 6570] fully compliant URI template expansion and
pattern matching library.  Supports symmetric matching where
`expand(match(url))` and `match(expand(vars))` behave predictably.

[JSR]: https://jsr.io/@fedify/uri-template
[JSR badge]: https://jsr.io/badges/@fedify/uri-template
[npm]: https://www.npmjs.com/package/@fedify/uri-template
[npm badge]: https://img.shields.io/npm/v/@fedify/uri-template?logo=npm
[RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570


Features
--------

 -  **Full RFC 6570 Level 4 support**: Handles all operators and modifiers
    (explode `*`, prefix `:n`)
 -  **Symmetric pattern matching**:
     -  `opaque`: byte-for-byte exact round-trips
     -  `cooked`: human-readable decoded values
     -  `lossless`: preserves both raw and decoded forms
 -  **Strict percent-encoding validation**: Prevents malformed sequences
    (`%GZ`, etc.)
 -  **Deterministic expansion**: Correctly handles undefined/empty values per
    RFC rules


Installation
------------

~~~~ sh
deno add jsr:@fedify/uri-template  # Deno
npm  add     @fedify/uri-template  # npm
pnpm add     @fedify/uri-template  # pnpm
yarn add     @fedify/uri-template  # Yarn
bun  add     @fedify/uri-template  # Bun
~~~~


Usage
-----

~~~~ typescript
import { compile } from "@fedify/uri-template";

const tmpl = compile("/repos{/owner,repo}{?q,lang}");

// Expansion
const url = tmpl.expand({ owner: "foo", repo: "hello/world", q: "a b" });
// => "/repos/foo/hello%2Fworld?q=a%20b"

// Matching
const result = tmpl.match("/repos/foo/hello%2Fworld?q=a%20b", {
  encoding: "cooked"
});
// => { owner: "foo", repo: "hello/world", q: "a b" }
~~~~

**Matching options:**

 -  `encoding`: `"opaque"` (default, preserves raw) | `"cooked"` (decoded) |
    `"lossless"` (both)
 -  `strict`: `true` (default, strict) | `false` (lenient parsing)


Documentation
-------------

For detailed implementation details, see [*specification.md*].

[*specification.md*]: ./docs/specification.md
