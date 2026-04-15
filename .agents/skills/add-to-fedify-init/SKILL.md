---
name: add-to-fedify-init
description: >-
  This skill is used to add an integration package to the @fedify/init
  package so that users can select the new framework via the `fedify init`
  command, and to test it with `mise test:init`.
argument-hint: "Provide the name of the web framework to register in @fedify/init."
---

<!-- deno-fmt-ignore-file -->

Adding an integration package to `@fedify/init`
===============================================

Follow these steps in order to register the integration package in
`@fedify/init` and verify it works.

1.  Add to `@fedify/init`
2.  Test with `mise test:init`
3.  Lint, format, and final checks


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
`WebFrameworkDescription` object, referring to
[init/framework.ts](./init/framework.ts).  Check the specifications in the
comments in `packages/init/src/types.ts` for details.

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


Lint, format, and final checks
------------------------------

Add keywords related to the framework in `.hongdown.toml` and `cspell.json` in
root path.

After implementation, run `mise run fmt && mise check`.
If there are lint or format errors, fix them and run the command again until
there are no errors.
