# @fedify/uri-template

RFC 6570 fully compliant URI template expansion and pattern matching library. Supports symmetric matching where `expand(match(url))` and `match(expand(vars))` behave predictably.

## Key Features

- **Full RFC 6570 Level 4 support** - Handles all operators and modifiers (explode `*`, prefix `:n`)
- **Symmetric pattern matching**
  - `opaque`: byte-for-byte exact round-trips
  - `cooked`: human-readable decoded values
  - `lossless`: preserves both raw and decoded forms
- **Strict percent-encoding validation** - Prevents malformed sequences (`%GZ`, etc.)
- **Deterministic expansion** - Correctly handles undefined/empty values per RFC rules

## Usage

~~~typescript
import { compile } from "url-template";

const tmpl = compile("/repos{/owner,repo}{?q,lang}");

// Expansion
const url = tmpl.expand({ owner: "foo", repo: "hello/world", q: "a b" });
// => "/repos/foo/hello%2Fworld?q=a%20b"

// Matching
const result = tmpl.match("/repos/foo/hello%2Fworld?q=a%20b", {
  encoding: "cooked"
});
// => { owner: "foo", repo: "hello/world", q: "a b" }
~~~

**Matching options:**

- `encoding`: `"opaque"` (default, preserves raw) | `"cooked"` (decoded) | `"lossless"` (both)
- `strict`: `true` (default, strict) | `false` (lenient parsing)

## Documentation

For detailed implementation details, see [spec.md](./docs/specification.md).
