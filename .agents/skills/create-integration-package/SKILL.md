---
name: create-integration-package
description: >-
  This skill is utilized when creating a web framework integration package.
  After examining the given framework, a feasibility assessment is conducted
  regarding the creation of an integration package.
  If implementation is feasible, the package is generated;
  if it is not possible, the rationale is provided to the user.
argument-hint: "Provide the name of the web framework you want to integrate with."
---

<!-- deno-fmt-ignore-file -->

Adding an integration package to a web framework
================================================

Follow these steps in order to implement the integration package.

1.  Research the web framework
2.  Implement the package
3.  Lint, format, and final checks


Research the web framework
--------------------------

Research the web framework for which the integration package will be
implemented using web searching.  Fedify operates as middleware via
[`Federation.fetch`](../../../packages/fedify/src/federation/federation.ts).
The critical question is whether the given framework can act as a server
framework and supports adding middleware.  Search for and investigate
whether the relevant functionality is available.  Assess feasibility based
on the research.  If research indicates implementation is not possible,
explain the reasons in detail to the user and stop.  If feasible, proceed
to create the package.  Even during package creation, it may turn out to be
infeasible.  In that case as well, explain the reasons in detail to the
user and stop.

### Verify actual installed versions

Framework documentation and the actual API of the installed version can
differ.  For example, hook names or middleware signatures may change
between major versions, or the underlying runtime
may expose different APIs than what the framework docs describe.  During
research, **always check the actual installed version** in the workspace:

 -  Read the framework's *package.json* (or *node\_modules*) to confirm
    the installed version.
 -  Cross-reference the installed version's API against the framework's
    official documentation.


Implement the package
---------------------

**Prioritize usability above all else.** The most important goal is that
the package integrates smoothly with the framework so users do not
experience friction when connecting it.

Create the package directory inside the `packages/` directory. For example, if
the framework is named “framework”, create the directory `packages/framework/`.

Copy the template files from the [package/](./package/) directory into
the directory you created. Use this commands in the root path:

~~~~ sh
mkdir -p packages/framework
cp -r .agents/skills/create-integration-package/package/* packages/framework/
~~~~

Then, implement the package according to the framework.  Since the comments in
the template are instructions for the developer to follow, please remove them
once the implementation is complete.

Unless there are significant hurdles, please set up the package to publish
on both JSR and NPM.  This means including both *deno.json* and *package.json*
files, and ensuring the code is compatible with both Deno and Node.js/Bun
environments.

After writing *deno.json* and *package.json* (or whenever you add or
change dependencies), run `mise run install` to update both *deno.lock*
and *pnpm-lock.yaml*.  This ensures all lockfiles stay in sync.

Add additional definitions as appropriate based on context.  Aside from the
main integration function and the `ContextDataFactory` type, keep module
exports to a minimum to avoid confusing users.

### Request flow

When a request arrives, the integration middleware calls
`federation.fetch()`.  If Fedify has a route for the path and the client's
`Accept` header includes an ActivityPub media type such as
`application/activity+json`, Fedify generates and returns the JSON-LD
response directly.  Framework-side routing does not execute.

#### Fallthrough on 404 (not found)

When `federation.fetch()` does not recognize the path, it invokes the
`onNotFound` callback.  The integration should delegate to the framework's
next handler so that non-federation routes (HTML pages, API endpoints,
etc.) are served normally.

#### Deferred 406 (not acceptable)

When Fedify owns the route but the client does not accept an ActivityPub
media type (e.g., a browser requesting `text/html`), it invokes the
`onNotAcceptable` callback.  The correct behavior is **not** to return
406 immediately.  Instead, give the framework a chance to serve its own
response (e.g., an HTML page at the same path).  Only return 406 if the
framework also has no content for that path (i.e., the framework would
return 404).  In Hono this looks like:

~~~~ typescript
async onNotAcceptable(_req: Request): Promise<Response> {
  await next();
  if (ctx.res.status !== 404) return ctx.res;
  return new Response("Not acceptable", {
    status: 406,
    headers: { "Content-Type": "text/plain", Vary: "Accept" },
  });
},
~~~~

### Request conversion

Some frameworks define and use their own `Request` type internally instead
of the Web API `Request`.  If the target framework does so, write
conversion functions within the integration package to translate between
the Web API `Request` and the framework's native `Request`.

### 406 not acceptable

The final failure 406 response uses this form:

~~~~ typescript
new Response("Not acceptable", {
  status: 406,
  headers: {
    "Content-Type": "text/plain",
    Vary: "Accept",
  },
});
~~~~

### Function naming conventions

A consistent naming convention for the main function has not yet been
established, but there is an [open naming convention issue].  If the issue
has been resolved by the time this skill is executed, update this section.
As a temporary convention, respect conventions of the framework : name it
`fedifyMiddleware` if the official documentation calls it as middleware, or
`fedifyHandler` if it's called a handler.

[open naming convention issue]: https://github.com/fedify-dev/fedify/issues/657

### Non-source files

#### README.md

The package README.md must include the following:

 -  Package description
 -  Supported framework versions, if only specific versions are supported
 -  Installation instructions
 -  Usage instructions (with example code)

#### `deno.json`

A *deno.json* is required to publish to JSR.

#### `package.json`

A *package.json* is required to publish to npm.

#### `tsdown.config.ts`

A *tsdown.config.ts* is required for the build in Node.js and Bun
environments.

### Other updates

Refer to the “Adding a new package” section in *CONTRIBUTING.md* and
perform the required updates.  Record the package addition in *CHANGES.md*.

### Tests

You can test the integration using `mise test:init`, which will be explained
later, but write unit tests as well if possible.  Name test files with the
`*.test.ts` convention (e.g., `src/mod.test.ts`).

#### Test runner

You can import the `test` function from `@fedify/fixture` for runtime-agnostic
tests that work across Deno, Node.js, and Bun.  Validate the values with
`node:assert/strict` assertions.

> **Warning**: `@fedify/fixture` is a **private** workspace package and
> must never be imported from published (non-test) source files.  Only
> import it in `*.test.ts` files.

If the framework relies on virtual modules, build-time code generation,
or other mechanisms that make `@fedify/fixture` impractical, you may use the
framework's own test utilities or a compatible test runner (e.g., `vitest`).
Document the choice in the test file so future contributors understand why a
different runner was chosen.

#### Minimum test coverage

At a minimum, test the following scenarios (see
*packages/fastify/src/index.test.ts* for a thorough reference):

1.  Fedify handles a federation request successfully (returns JSON-LD).
2.  Non-federation requests are delegated to the framework (`onNotFound`
    fallthrough).
3.  A 406 response is returned when the client does not accept
    ActivityPub and no framework route matches
    (`onNotAcceptable` + framework 404).
4.  The framework serves its own response when a route is shared and
    the client prefers HTML (`onNotAcceptable` + framework 200).

### Implementation checklist

1.  Create the *packages/framework/* directory
2.  Write source files (typically *src/mod.ts*):
     -  Export the main integration middleware/handler function
     -  Implement `federation.fetch()` invocation with
        `onNotFound`/`onNotAcceptable` (see “Request flow” for the
        expected fallthrough behavior)
     -  Export the `ContextDataFactory` type
     -  Write conversion functions if the framework does not natively
        support Web API `Request`/`Response`
3.  Write *README.md*
4.  Write *deno.json* (if publishing to JSR is intended)
5.  Write *package.json* (if publishing to npm is intended)
6.  Run `mise run install`
7.  Write *tsdown.config.ts* (if Node.js and Bun are supported)
8.  Write tests if possible
9.  Perform remaining updates per the “Adding a new package” section in
    *CONTRIBUTING.md*
10. Record changes in *CHANGES.md*


Lint, format, and final checks
------------------------------

Add keywords related to the framework in `.hongdown.toml` and `cspell.json` in
root path. Especially, the package name `@fedify/framework` should be added to
the `.hongdown.toml`.

After implementation, run `mise run fmt && mise run check`.
If there are lint or format errors, fix them and run the command again until
there are no errors.


Next steps
----------

Unless there are critical blockers (e.g., the package fails to build or
tests do not pass), **strongly consider** proceeding immediately with
the following two skills to complete the full integration:

1.  **`add-to-fedify-init`**: Add the new package to the `fedify init`
    command so users can select it when creating a new project.
2.  **`create-example-app-with-integration`**: Create an example
    application that demonstrates the integration.
