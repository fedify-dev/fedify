<!-- deno-fmt-ignore-file -->

@fedify/uri-template: Symmetric RFC 6570 URI Template library
=============================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]

This package provides an [RFC 6570] URI Template implementation that performs
both expansion and pattern matching with guaranteed symmetric (round-trip)
behavior.  It is part of the [Fedify] framework but can be used independently.

[JSR badge]: https://jsr.io/badges/@fedify/uri-template
[JSR]: https://jsr.io/@fedify/uri-template
[npm badge]: https://img.shields.io/npm/v/@fedify/uri-template?logo=npm
[npm]: https://www.npmjs.com/package/@fedify/uri-template
[RFC 6570]: https://datatracker.ietf.org/doc/html/rfc6570
[Fedify]: https://fedify.dev/


Why `@fedify/url-template`?
---------------------------

Fedify used [url-template] as the baseline implementation before writing
`@fedify/url-template`.  That package describes itself as an RFC 6570
implementation, but its behavior is not strict enough for Fedify's URI routing
and round-trip matching needs.  The benchmark in *bench/url-template.test.ts*
records the differences against `npm:url-template@^3.1.1`.

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
    to the invoking application.  `@fedify/url-template` reports these cases as
    typed errors.
 -  It applies prefix modifiers to composite values such as lists and
    associative arrays.  [RFC 6570 §2.4.1] states that prefix modifiers are not
    applicable to variables with composite values, so `{list:3}`, `{keys:3}`,
    and `{count:2}` must fail.

`@fedify/url-template` was written as a new implementation instead of wrapping
[url-template] because Fedify needs strict RFC 6570 expansion, typed syntax
errors, and symmetric matching behavior.  Applications that need a looser
parser can opt in explicitly: `strict: false` reports parse and expansion
errors without throwing, and a custom `report` function can allow all errors or
throw only for selected error classes.

[url-template]: https://www.npmjs.com/package/url-template
[RFC 6570 §2.3]: https://datatracker.ietf.org/doc/html/rfc6570#section-2.3
[RFC 6570 §3.2.8]: https://datatracker.ietf.org/doc/html/rfc6570#section-3.2.8
[RFC 6570 §2.1]: https://datatracker.ietf.org/doc/html/rfc6570#section-2.1
[RFC 6570 §2]: https://datatracker.ietf.org/doc/html/rfc6570#section-2
[RFC 6570 §3]: https://datatracker.ietf.org/doc/html/rfc6570#section-3
[RFC 6570 §2.4.1]: https://datatracker.ietf.org/doc/html/rfc6570#section-2.4.1


Features
--------

 -  Full RFC 6570 expansion for all expression types
    (`{var}`, `{+var}`, `{#var}`, `{.var}`, `{/var}`, `{;var}`, `{?var}`,
    `{&var}`)
 -  Symmetric pattern matching that mirrors expansion to guarantee
    `expand(parse(url)) === url` and `parse(expand(value)) === value`
 -  Strict TypeScript types with no `any` in the public surface
 -  Zero runtime dependencies


Installation
------------

~~~~ bash
deno add jsr:@fedify/uri-template  # Deno
npm  add @fedify/uri-template       # npm
pnpm add @fedify/uri-template       # pnpm
yarn add @fedify/uri-template       # Yarn
bun  add @fedify/uri-template       # Bun
~~~~
