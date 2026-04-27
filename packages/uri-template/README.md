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
