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
2.  Create the package directory
3.  Implement the package
4.  Add to `@fedify/init`
5.  Test with `mise test:init`
6.  Add an example
7.  Lint, format, and final checks


Research the web framework
--------------------------

Research the web framework for which the integration package will be
implemented.  Fedify operates as middleware via
[`Federation.fetch`](../../../packages/fedify/src/federation/federation.ts).
The critical question is whether the given framework can act as a server
framework and supports adding middleware.  Search for and investigate
whether the relevant functionality is available.  Assess feasibility based
on the research.  If research indicates implementation is not possible,
explain the reasons in detail to the user and stop.  If feasible, proceed
to create the package.  Even during package creation, it may turn out to be
infeasible.  In that case as well, explain the reasons in detail to the
user and stop.


Implement the package
---------------------

**Prioritize usability above all else.** The most important goal is that
the package integrates smoothly with the framework so users do not
experience friction when connecting it.

Unless there are significant hurdles, please set up the package to publish
on both JSR and NPM.

Create the package directory inside the `packages/` directory. For example, if
the framework is named “framework”, create the directory `packages/framework/`.

Copy the template files from <package/\*> into the directory you created. Then,
implement the package according to the framework. Since the comments in the
template are instructions for the developer to follow, please remove them once
the implementation is complete.

Add additional definitions as appropriate based on context.  Aside from the
main integration function and the `ContextDataFactory` type, keep module
exports to a minimum to avoid confusing users.

### Request flow

When a request arrives, the integration middleware calls
`federation.fetch()`.  If Fedify has a route for the path and the client's
`Accept` header includes an ActivityPub media type such as
`application/activity+json`, Fedify generates and returns the JSON-LD
response directly.  Framework-side routing does not execute.

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

Unit tests aren't mandatory since you can test using `mise test:init`, which
will be explained later. Therefore, testing by packages is not necessary.

### Implementation checklist

1.  Create the *packages/framework/* directory
2.  Write *src/mod.ts*:
     -  Export the main integration middleware/handler function
     -  Implement `federation.fetch()` invocation with
        `onNotFound`/`onNotAcceptable`
     -  Export the `ContextDataFactory` type
     -  Write conversion functions if the framework does not natively support
        Web API `Request`/`Response`
3.  Write *README.md*
4.  Write *deno.json* (if publishing to JSR is intended)
5.  Write *package.json* (if publishing to npm is intended)
6.  Write *tsdown.config.ts* (if Node.js and Bun are supported)
7.  Write tests if possible
8.  Perform remaining updates per the “Adding a new package” section in
    *CONTRIBUTING.md*
9.  Record changes in *CHANGES.md*


Add to `@fedify/init`
---------------------

Add the new package to the `@fedify/init` package so users can select the
new framework via the `fedify init` command.  Follow these steps.

Steps may require code modifications not explicitly listed.  For example,
if the new package needs specific configuration, utility functions in
`packages/init/src/webframeworks/utils.ts` may need updating.  Make
modifications consistent with the existing code style and context.

### Write the `WebFrameworkDescription` object

Create a `packages/init/src/webframeworks/framework.ts` file and write the
`WebFrameworkDescription` object, referring to <init/framework.ts>.  Check
the specifications in the comments in `packages/init/src/types.ts` for
details.

### Add to the `WEB_FRAMEWORK` array

Add the new framework name to the end of the `WEB_FRAMEWORK` array in
`packages/init/src/const.ts`.

~~~~ typescript
export const WEB_FRAMEWORK = [
  // ... other frameworks
  "framework", // Fill with the framework name
];
~~~~

### Add to the `webFrameworks` object

Add the new `WebFrameworkDescription` object in alphabetical order to the
`webFrameworks` object in `packages/init/src/webframeworks/mod.ts`.

~~~~ typescript
// packages/init/src/webframeworks/mod.ts

// ... other imports
import framework from "./framework.ts"; // Fill with the framework name

const webFrameworks: Record<string, WebFrameworkDescription> = {
  // ... other frameworks
  framework, // Fill with the framework name
};
~~~~

### Add templates in `packages/init/src/templates/framework/`

If additional files need to be generated, add template files under the
`packages/init/src/templates/framework/` directory.  Template files must
end with the `.tpl` extension appended to their base name.  Then, in
`packages/init/src/webframeworks/framework.ts`, load the templates using
the `readTemplate` function defined in `packages/init/src/lib.ts` and add
them to the `WebFrameworkDescription.init().files` object.


Test with `mise test:init`
--------------------------

Run `mise test:init` to verify that the new package is generated and runs
correctly.  If a test fails, the output and error file paths are printed;
read them to diagnose the issue.

Running `mise test:init` without arguments tests all option combinations
and can take a very long time.  Use appropriate options to narrow the test
scope.

Immediately remove test paths after completing the tests and analyzing any
resulting errors.

At a minimum, test the following three combinations.

 -  `mise test:init -w framework -m in-process -k in-memory --no-dry-run`:
    Tests the new framework with the in-memory KV store and in-process message
    queue, which are the most basic options.  This combination verify that the
    newly created package can be used without issues by minimizing dependencies
    on other environments.
 -  `mise test:init -w framework`: Tests all package manager, KV store,
    and message queue combinations with the framework selected.  If a
    required database is not installed or running, this combinations are
    useless. Therefore, if the test output indicates that the databases are
    not running, don't use this combination ever again for the session.  
    Instead, use the previous one or the next one.
 -  `mise test:init -m in-process -k in-memory --no-dry-run`: Fixes the
    KV store and message queue and tests all web framework and package
    manager combinations.  This test is mandatory if you modified logic
    beyond just writing the `WebFrameworkDescription` object.

For details on options, run `mise test:init --help`.

Some frameworks or combinations may be untestable.  Analyze the test
results; if there are impossible combinations, identify the reason and add
the combination and reason as a key-value pair to the
`BANNED_LOOKUP_REASONS` object in
`packages/init/src/test/lookup.ts`.


Add an example
--------------

Create an `examples/framework/` app and write an example for the new
package.  If Deno is supported, add a *deno.json* based on <example/deno.json>;
if Node.js is supported, add *package.json* based on <example/package.jsonc>
and *tsdown.config.ts*.  Depending on the supported environments,
add the example path to the `workspace` field in
the root *deno.json* and to the `packages` field in
*pnpm-workspace.yaml*.

If the framework is backend-only and needs a frontend framework, and there
is no natural pairing like solidstart-solid, use Hono.

Base the example on the files under the <example/\*> path.
<example/ARCHITECTURE.md> describes the example's architecture.
<example/DESIGN.md> describes the example's design.  Both documents are
references for writing the example and are not needed in the actual
generated example app — do not create these two files.  Copy the remaining
files as-is and modify as needed.

If the framework does not have a prescribed entry point, use `src/main.ts`
as the application entry point.  Define and export the framework app in
`src/app.ts`, then import and run it from the entry file.  Register the
Fedify middleware in `src/app.ts`.  Import `src/logging.ts` in the entry
file to initialize `@logtape/logtape`.  When logging is needed, use the
`getLogger` function from `@logtape/logtape` to create a logger.

### Test the example with `mise test:examples`

Register the new example in `examples/test-examples/mod.ts`.  Read the
comments above the example registry arrays in that file to determine
which array is appropriate and what fields are required.  Follow the
patterns of existing entries.

Before running the tests, ensure that the tunneling service is usable.  
The tests use the tunneling service `pinggy.io` to make the example app
accessible to the test suite.  If the tunneling service is not usable,
the tests may not finish forever or may fail due to a connection error.

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


Lint, format, and final checks
------------------------------

Add keywords related to the framework in `.hongdown.toml` and `cspell.json` in
root path. Especially, the package name `@fedify/framework` should be added to
the `.hongdown.toml`.

After implementation, run `mise run fmt && mise check`.
If there are lint or format errors, fix them and run the command again until
there are no errors.
