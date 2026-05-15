<!-- deno-fmt-ignore-file -->

@fedify/uri-template: Round-trip RFC 6570 URI Template library
==============================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides an [RFC 6570] URI Template implementation that performs
both expansion and pattern matching with round-trip verification.  It is part of
the [Fedify] framework but can be used independently.

[JSR badge]: https://jsr.io/badges/@fedify/uri-template
[JSR]: https://jsr.io/@fedify/uri-template
[npm badge]: https://img.shields.io/npm/v/@fedify/uri-template?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/uri-template
[RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
[Fedify]: https://fedify.dev/


Why `@fedify/uri-template`?
---------------------------

Fedify previously relied on two independent third-party implementations:
[url-template] for URI Template expansion and [uri-template-router] for
route matching.  `@fedify/uri-template` replaces both with one strict RFC 6570
parser and one expansion/matching model.

[url-template]: https://www.npmjs.com/package/url-template
[uri-template-router]: https://www.npmjs.com/package/uri-template-router

### Why replacing [url-template] with `Template`?

[url-template] describes itself as an RFC 6570 implementation, but its behavior
is not strict enough for Fedify's URI routing and round-trip matching needs.
The test in *old/url-template.test.ts* records the differences against
`npm:url-template@^3.1.1`.

The important failures are:

 -  It double-encodes pct-encoded triplets in variable names when named
    operators emit the variable name.  For example, `{?abc%20def}` expands to
    `?abc%2520def=spaced` instead of `?abc%20def=spaced`.  [RFC 6570 §2.3]
    allows `pct-encoded` inside `varname` and treats it as part of the
    variable name.  [RFC 6570 §3.2.8] emits the variable name as a literal
    string, and [RFC 6570 §2.1] permits `pct-encoded` literals.  Therefore
    `%20` and `%41` must be preserved, not encoded again as `%2520` and
    `%2541`.
 -  It accepts malformed templates instead of reporting syntax errors.
    [RFC 6570 §2] requires expressions to be delimited by matching braces,
    [RFC 6570 §2.1] excludes raw braces, control characters, spaces, raw `%`
    outside a pct-encoded triplet, and other forbidden literal characters, and
    [RFC 6570 §3] says grammar errors should indicate their location and type
    to the invoking application.  `@fedify/uri-template` reports these cases as
    typed errors.
 -  It applies prefix modifiers to composite values such as lists and
    associative arrays.  [RFC 6570 §2.4.1] states that prefix modifiers are not
    applicable to variables with composite values, so `{list:3}`, `{keys:3}`,
    and `{count:2}` must fail.

`Template` was written as a new implementation instead of wrapping
[url-template] because Fedify needs strict RFC 6570 expansion, typed syntax
errors, and round-trip-checked matching behavior.  Applications that need a
looser parser can opt in explicitly: `strict: false` passes parse and expansion
errors to `report` without throwing, and a custom `report` function can allow
all errors or throw only for selected error classes.

[RFC 6570 §2.3]: https://datatracker.ietf.org/doc/html/rfc6570#section-2.3
[RFC 6570 §3.2.8]: https://datatracker.ietf.org/doc/html/rfc6570#section-3.2.8
[RFC 6570 §2.1]: https://datatracker.ietf.org/doc/html/rfc6570#section-2.1
[RFC 6570 §2]: https://datatracker.ietf.org/doc/html/rfc6570#section-2
[RFC 6570 §3]: https://datatracker.ietf.org/doc/html/rfc6570#section-3
[RFC 6570 §2.4.1]: https://datatracker.ietf.org/doc/html/rfc6570#section-2.4.1

### Why replacing [uri-template-router] with `Router`?

The previous router shape combined two independent third-party
implementations: [url-template] for building URLs and [uri-template-router] for
matching URLs.  *old/uri-template-router.test.ts* defines that old shape as
closely as possible so the differences are visible under the same route API.

The important differences are:

 -  Build, match, and variable extraction all use the same strict RFC 6570
    parser.  The previous router expanded with [url-template] but matched with
    [uri-template-router], so a value could be encoded by one implementation
    and decoded by another with different rules.
 -  Route matches are round-trip checked.  A candidate route is accepted only
    when the recovered values expand back to the exact input URI.  This rejects
    matches that look plausible after decoding but cannot reproduce the
    original URI.  By default, matching is exact against the input URI.
    `trailingSlashInsensitive` can be enabled to use a looser path lookup for
    trailing slash differences before applying the same round-trip check.
 -  Pct-encoded triplets are preserved where RFC 6570 treats them as syntax.
    Literal triplets, pct-encoded variable names, and named query parameters
    such as `{?abc%20def}` remain `%20` instead of becoming `%2520`.
 -  Reserved expansion values keep their encoded form when that is what the
    URI contained.  Under the previous matching path, `/files/a%2Fb` could be
    reported as `a/b`, `/files/%30%23` as `0#`, and pct-encoded UTF-8 octets as
    Unicode text.  Those values do not round-trip to the original URI under the
    same template.
 -  Path templates are validated by `Router.compile()` before registration.
    The new router supports ordinary slash-prefixed paths and the leading path
    expansion form used by Fedify routes, such as `{/identifier}/inbox`.
 -  `Router.variables()` and `Router.compile()` expose variable extraction
    without mutating a router.  The legacy `Router.add()` returned variables as
    a side effect of registering the route.
 -  Candidate lookup combines a token-level state trie with a fallback prefix
    trie.  Indexable path templates—those whose expressions each hold a single
    variable with the `""`, `/`, or `+` operator and never sit directly
    adjacent to another expression—are walked token by token in the state
    trie.  Shapes that cannot be safely indexed fall back to a prefix trie
    keyed by the initial literal prefix of each route.  Candidates from both
    tries are merged, deduplicated, and ordered deterministically by literal
    length, initial literal prefix length, variable count, and insertion order
    before the round-trip matcher runs.
 -  Cloning and route replacement do not depend on copying private mutable
    state from [uri-template-router].  The router stores compiled templates and
    active route entries directly, which keeps the implementation independent
    and dependency-free at runtime.

The concrete differences from the previous [url-template] and
[uri-template-router] libraries are encoded as compatibility tests under
*packages/uri-template/old/* in the package's source repository.  Refer to
those tests for behavior comparisons against the older libraries; they are
not shipped in the published package.


Features
--------

 -  Full RFC 6570 expansion for all expression types
    (`{var}`, `{+var}`, `{#var}`, `{.var}`, `{/var}`, `{;var}`, `{?var}`,
    `{&var}`)
 -  Round-trip pattern matching that mirrors expansion: when `match(uri)`
    returns values, `expand(values) === uri`
 -  Strict TypeScript types with no `any` in the public surface
 -  Zero runtime dependencies


Installation
------------

~~~~ bash
deno add jsr:@fedify/uri-template  # Deno
npm  add     @fedify/uri-template  # npm
pnpm add     @fedify/uri-template  # pnpm
yarn add     @fedify/uri-template  # Yarn
bun  add     @fedify/uri-template  # Bun
~~~~
