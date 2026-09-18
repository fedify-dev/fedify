---
links:
  '#1006': https://github.com/fedify-dev/fedify/pull/1006
  '#139': https://github.com/fedify-dev/fedify/issues/139
---
 -  Added the new *@fedify/adonisjs* package, an integration for the AdonisJS
    framework.  It provides a server middleware that mounts a `Federation`
    inside an AdonisJS application, a service provider that owns the
    federation's lifecycle, a `node ace configure` hook that scaffolds
    *config/fedify.ts* and the federation preload files, and a `ctx.federation`
    request context.  The package targets Node.js and is published to npm only.
    [[#139], [#1006] by Samuel Brinkmann]
