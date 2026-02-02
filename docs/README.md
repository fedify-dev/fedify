Fedify docs
===========

This directory contains the source files of the Fedify docs.  The docs are
written in Markdown format and are built with [VitePress].

In order to build the docs locally, you need to install [Node.js] and [pnpm]
first. Then you can run the following commands (assuming you are in
the *docs/* directory):

~~~~ bash
pnpm install
pnpm dev
~~~~

Once the development server is running, you can open your browser and navigate
to *http://localhost:5173/* to view the docs.

[VitePress]: https://vitepress.dev/
[Node.js]: https://nodejs.org/
[pnpm]: https://pnpm.io/


VitePress documentation conventions
-----------------------------------

The *docs/* directory uses VitePress with additional features beyond standard
Markdown.

### Twoslash code blocks

Use the `twoslash` modifier to enable TypeScript type checking and hover
information in code blocks:

~~~~~ markdown
~~~~ typescript twoslash
import { createFederation } from "@fedify/fedify";

const federation = createFederation({ kv: undefined! });
~~~~
~~~~~

### Fixture variables

When code examples need variables that shouldn't be shown to readers,
declare them *before* the `// ---cut-before---` directive.  Content before
this directive is compiled but hidden from display:

~~~~~ markdown
~~~~ typescript twoslash
import type { KvStore } from "@fedify/fedify";
declare const kv: KvStore;
// ---cut-before---
import { createFederation } from "@fedify/fedify";

const federation = createFederation({ kv });
~~~~
~~~~~

The reader sees only the code after `---cut-before---`, but TypeScript
checks the entire block including the hidden fixture.

### Code groups

Use code groups to show the same content for different package managers
or environments:

~~~~~ markdown
::: code-group

~~~~ bash [Deno]
deno add jsr:@fedify/fedify
~~~~

~~~~ bash [npm]
npm add @fedify/fedify
~~~~

~~~~ bash [pnpm]
pnpm add @fedify/fedify
~~~~

:::
~~~~~

### Internal links

 -  When linking to other VitePress documents within the *docs/* directory,
    use inline link syntax (e.g., `[text](./path/to/file.md)`) instead of
    reference-style links.
 -  Always use relative paths for internal links.
 -  Include the `.md` extension in internal link paths.

### Building documentation

~~~~ bash
moon run docs:build    # Build for production (runs Twoslash type checking)
moon run docs:dev          # Start development server
~~~~

Always run `moon run docs:build` before committing to catch Twoslash
type errors.
