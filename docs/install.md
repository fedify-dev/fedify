---
description: How to install Fedify.
---
Installation
============


Quick start
-----------

The easiest way to start a new Fedify project is to use the `fedify init`
command.  It creates a new directory with a minimal Fedify project template.

### CLI toolchain

First of all, you need to have the `fedify` command, the Fedify CLI toolchain,
installed on your system.  If you haven't installed it yet, please follow the
following instructions:

::: code-group

~~~~ sh [npm]
npm install -g @fedify/cli
~~~~

~~~~ sh [Homebrew (Linux/macOS)]
brew install fedify
~~~~

~~~~ powershell [Scoop (Windows)]
scoop install fedify
~~~~

~~~~ sh [Bun]
bun install -g @fedify/cli
~~~~

~~~~ sh [Deno]
deno install -gA --unstable-fs --unstable-kv --unstable-temporal -n fedify jsr:@fedify/cli
~~~~

:::

There are other ways to install the `fedify` command.  Please refer to the
[*Installation* section](./cli.md#installation) in the *CLI toolchain* docs.

### Project setup

After installing the `fedify` command, you can create a new Fedify project by
running the following command:

~~~~ sh
fedify init your-project-dir
~~~~

The above command will start a wizard to guide you through the project setup.
You can choose the JavaScript runtime, the package manager, and the web
framework you want to integrate Fedify with, and so on.  After the wizard
finishes, you will have a new Fedify project in the *your-project-dir*
directory.

For more information about the `fedify init` command, please refer to the
[*`fedify init`* section](./cli.md#fedify-init-initializing-a-fedify-project)
in the *CLI toolchain* docs.

[![The “fedify init” command demo](https://asciinema.org/a/671658.svg)](https://asciinema.org/a/671658)


Manual installation
-------------------

Fedify is available on [JSR] for [Deno] and on [npm] for [Bun] and [Node.js].

[JSR]: https://jsr.io/@fedify/fedify
[Deno]: https://deno.com/
[npm]: https://www.npmjs.com/package/@fedify/fedify
[Bun]: https://bun.sh/
[Node.js]: https://nodejs.org/


### Deno

[Deno] is the primary runtime for Fedify.  As a prerequisite, you need to have
Deno 2.0.0 or later installed on your system.  Then you can install Fedify
via the following command:

~~~~ sh
deno add jsr:@fedify/fedify
~~~~

Since Fedify requires [`Temporal`] API, which is an unstable feature in Deno as
of November 2024, you need to add the `"temporal"` to the `"unstable"` field of
the *deno.json* file:

~~~~ json{5}
{
  "imports": {
    "@fedify/fedify": "jsr:@fedify/fedify"
  },
  "unstable": ["temporal"]
}
~~~~

[`Temporal`]: https://tc39.es/proposal-temporal/docs/

### Bun

Fedify can also be used in Bun.  You can install it via the following
command:

~~~~ sh
bun add @fedify/fedify
~~~~

### Node.js

Fedify can also be used in Node.js.  As a prerequisite, you need to have Node.js
22.0.0 or later installed on your system.  Then you can install Fedify via
the following command:

::: code-group

~~~~ sh [npm]
npm add @fedify/fedify
~~~~

~~~~ sh [pnpm]
pnpm add @fedify/fedify
~~~~

~~~~ sh [Yarn]
yarn add @fedify/fedify
~~~~

:::

We recommend using [ESM] with Fedify by adding `"type": "module"` to the
*package.json* file. While Fedify also supports [CommonJS] for legacy
compatibility, ESM is the preferred approach:

~~~~ json{2}
{
  "type": "module",
  "dependencies": {
    "@fedify/fedify": "^1.8.1"
  }
}
~~~~

[ESM]: https://nodejs.org/api/esm.html
[CommonJS]: https://nodejs.org/docs/latest/api/modules.html
