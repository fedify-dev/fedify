---
links:
  '#1305': https://github.com/fedify-dev/fedify/issues/1305
  '#1307': https://github.com/fedify-dev/fedify/pull/1307
---
 -  Fixed missing runtime dependencies in the npm package.  `@fedify/vocab`
    and `@js-temporal/polyfill` are now installed automatically so importing
    `@fedify/testing` works even when dependency hoisting is disabled on
    Node.js and Bun.  [[#1305], [#1307]]
