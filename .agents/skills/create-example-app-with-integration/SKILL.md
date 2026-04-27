---
name: create-example-app-with-integration
description: >-
  This skill is used to create an example application for a web framework
  integration package and to test it with `mise test:examples`.
argument-hint: "Provide the name of the web framework to create an example for."
---

<!-- deno-fmt-ignore-file -->

Creating an example for an integration package
==============================================

Follow these steps in order to create the example application and verify
it works.

1.  Set up the example project
2.  Implement the example app
3.  Test the example with `mise test:examples`
4.  Lint, format, and final checks


Reference documents
-------------------

Two reference documents describe what the example must do and how it must
look.  Both are references only — do not create these files in the actual
generated example app.

### [ARCHITECTURE.md](./ARCHITECTURE.md)

Defines the example's functional behavior.  Consult it for:

 -  **Middleware integration**: How to register the Fedify middleware so it
    intercepts ActivityPub requests before application routes.
 -  **Reverse proxy support**: When and how to apply
    `getXForwardedRequest` from `x-forwarded-fetch`.
 -  **Routing**: The complete list of routes (`GET /`, `GET /users/…`,
    `POST /post`, `POST /follow`, `POST /unfollow`, `GET /events`, etc.)
    with their expected request/response behavior.
 -  **Server-sent events**: How the `/events` endpoint keeps an open SSE
    connection and broadcasts changes to the client.
 -  **Server-side data access**: How to use Fedify's `RequestContext` to
    bridge between the framework routing layer and the federation layer.
 -  **Federation** and **Storing**: Which source files to set up
    (`src/federation.ts`, `src/store.ts`) and the template files they are
    based on ([example/src/federation.ts](./example/src/federation.ts),
    [example/src/store.ts](./example/src/store.ts)).
 -  **Logging**: How to use `@logtape/logtape` and `src/logging.ts`.

### [DESIGN.md](./DESIGN.md)

Defines the example's visual presentation.  Consult it for:

 -  **Visual theme & atmosphere**: Light/dark theme with
    `prefers-color-scheme` detection.
 -  **Color palette & roles**: Surface, accent, neutral, and shadow tokens.
 -  **Typography rules**: Font family, size hierarchy, and weight
    principles.
 -  **Component stylings**: Profile header, avatar, cards, search input,
    compose form, buttons, back link, and Fedify badge.
 -  **Layout principles**: Spacing, containers, grid, and whitespace.
 -  **Responsive behavior**: Single breakpoint at `768px` and mobile
    adaptations.
 -  **Static assets**: Files to serve from `public/`
    ([example/public/](./example/public/)).
 -  **Page structure**: Detailed layout of the home page, actor profile
    page, and post detail page.


Set up the example project
--------------------------

Create an `examples/framework/` app and write an example for the new
package. Copy the template files from [example/](./example/) as-is and modify
as needed.

 -  [deno.json](./example/deno.jsonc)
     -  Deno configuration for the example app.
     -  If the framework does not support Deno, this file can be omitted.
 -  [package.json](./example/package.jsonc)
     -  Node.js configuration for the example app.
     -  If the framework does not support Node.js, this file can be omitted.
 -  [federation.ts](./example/src/federation.ts): Set up the Federation instance
    and configure ActivityPub handling.
 -  [logging.ts](./example/src/logging.ts): Set up Logtape logging.
 -  [store.ts](./example/src/store.ts): Set up in-memory stores for actors,
    posts, and followers.
 -  [fedify-logo.svg](./example/public/fedify-logo.svg)
     -  The Fedify logo.
     -  Use this file as favicon.
     -  You can make a custom logo to add the svg of the framework logo.
 -  [demo-profile.png](./example/public/demo-profile.png):
     -  Profile image for the demo user.
     -  You can make this image from the `fedify-logo.svg` rendering to png
 -  [style.css](./example/public/style.css): The CSS file for the example app.
 -  [theme.js](./example/public/theme.js): The JavaScript file for theme
    toggling dark/light mode in the example app.

Unless the framework itself prevents it, support both Deno
and Node.js environments.  If Deno is supported, add a *deno.json* based on
[example/deno.json](./example/deno.jsonc); if Node.js is supported, add
*package.json* based on [example/package.jsonc](./example/package.jsonc) and
*tsdown.config.ts*.  Depending on the supported environments, add the example
path to the `workspace` field in the root *deno.json* and to the `packages`
field in *pnpm-workspace.yaml*.

If the framework is backend-only and needs a frontend framework, and there
is no natural pairing like solidstart-solid, use Hono.

If the framework does not have a prescribed entry point, use `src/main.ts`
as the application entry point.  Define and export the framework app in
`src/app.ts`, then import and run it from the entry file.  Import
`src/logging.ts` in the entry file to initialize `@logtape/logtape`.
When logging is needed, use the `getLogger` function from `@logtape/logtape`
to create a logger.

When configuring the example app server, disable host restrictions and allow
all hosts so tunneled/public domains can access the app during development
and tests.


Implement the example app
-------------------------

Follow the specifications in [ARCHITECTURE.md](./ARCHITECTURE.md) and
[DESIGN.md](./DESIGN.md) to implement the example.  In particular:

 -  Register the Fedify middleware in `src/app.ts` per the “Middleware
    integration” and “Reverse proxy support” sections of
    [ARCHITECTURE.md](./ARCHITECTURE.md).
 -  Set up federation logic in `src/federation.ts` based on
    [example/src/federation.ts](./example/src/federation.ts).  Set up in-memory
    stores in `src/store.ts` based on
    [example/src/store.ts](./example/src/store.ts).
 -  Implement all routes listed in the “Routing” section of
    [ARCHITECTURE.md](./ARCHITECTURE.md), using `RequestContext` as described
    in the “Server-side data access” section.
 -  Render HTML pages according to [DESIGN.md](./DESIGN.md).  Serve static
    assets from the `public/` directory (copy from
    [example/public/](./example/public/)).
 -  Implement the SSE endpoint per the “Server-sent events” section of
    [ARCHITECTURE.md](./ARCHITECTURE.md).
 -  Ensure the app can build and run in the supported environments
    (Deno, Node.js, or both).


Test the example with `mise test:examples`
------------------------------------------

Register the new example in `examples/test-examples/mod.ts`.  Read the
comments above the example registry arrays in that file to determine
which array is appropriate and what fields are required.  Follow the
patterns of existing entries.

Before running the tests, ensure that the tunneling service is usable.  
The tests use the tunneling service `pinggy.io` to make the example app
accessible to the test suite.  If the tunneling service is not usable,
the tests may never finish or may fail due to a connection error.

While developing the example, run only the new example to iterate
quickly:

~~~~ bash
mise test:examples framework
~~~~

where `framework` is the `name` field of the registered entry.  Pass
`--debug` for verbose output if the test fails.

After the example is complete, run the full suite once to confirm nothing
is broken:

~~~~ bash
mise test:examples
~~~~

If the `test:examples` cannot be run, just run the server and test with curl:

~~~~ bash
curl -H "Accept: application/activity+json" http://localhost:0000/users/demo
~~~~


Lint, format, and final checks
------------------------------

Add keywords related to the framework in `.hongdown.toml` and `cspell.json` in
root path.

After implementation, run `mise run fmt && mise check`.
If there are lint or format errors, fix them and run the command again until
there are no errors.
