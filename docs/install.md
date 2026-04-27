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
deno install -gA --unstable-fs --unstable-kv -n fedify jsr:@fedify/cli
~~~~

:::

If you use Deno earlier than 2.7.0, add `--unstable-temporal` to the Deno
installation command above.

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

### Alternative: Using `@fedify/create`

If you don't want to install the `fedify` CLI globally, you can use
`@fedify/create` directly:

::: code-group

~~~~ sh [npm]
npm init @fedify your-project-dir
~~~~

~~~~ sh [pnpm]
pnpm create @fedify your-project-dir
~~~~

~~~~ sh [Yarn]
yarn create @fedify your-project-dir
~~~~

~~~~ sh [Bun]
bunx @fedify/create your-project-dir
~~~~

:::

This works the same way as `fedify init` and will guide you through the same
project setup wizard.

> [!TIP]
> Already running a federated service on another JavaScript ActivityPub
> library?  See [*Migrating from other libraries*](./manual/migrate.md) for
> guides covering `activitypub-express`, `@activity-kit/*`, hand-rolled
> Express code, and `activitystrea.ms`.


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

Fedify requires the [`Temporal`] API.  On Deno 2.7.0 or later, it is stable and
no extra setting is needed.  On Deno versions earlier than 2.7.0, add
`"temporal"` to the `"unstable"` field in *deno.json*:

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


Editor setup
------------

`fedify init` configures Visual Studio Code for you out of the box.  Setting
up [Zed] takes a few extra steps because `fedify init` does not generate
*.zed/* files yet.

[Zed]: https://zed.dev/

### Visual Studio Code

*For Deno projects*, `fedify init` writes a *.vscode/extensions.json* that
recommends the [Deno extension]:

~~~~ json [.vscode/extensions.json]
{ "recommendations": ["denoland.vscode-deno"] }
~~~~

The matching *.vscode/settings.json* turns on Deno's language server and sets
it as the default formatter for JavaScript and TypeScript:

~~~~ jsonc [.vscode/settings.json]
{
  "deno.enable": true,
  "deno.unstable": true,
  "editor.detectIndentation": false,
  "editor.indentSize": 2,
  "editor.insertSpaces": true,
  "[typescript]": {
    "editor.defaultFormatter": "denoland.vscode-deno",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.sortImports": "always"
    }
  }
  // The same block applies to [javascript], [javascriptreact], and
  // [typescriptreact]; [json] and [jsonc] use "vscode.json-language-features".
}
~~~~

Deno's [*Set up your environment*] guide covers other editors and shells.

*For Node.js/Bun projects*, `fedify init` writes a *.vscode/extensions.json*
that recommends the [Biome extension] and the [ESLint extension]:

~~~~ json [.vscode/extensions.json]
{ "recommendations": ["biomejs.biome", "dbaeumer.vscode-eslint"] }
~~~~

The matching *.vscode/settings.json* sets Biome as the default formatter and
runs Biome's import organiser on save:

~~~~ jsonc [.vscode/settings.json]
{
  "editor.detectIndentation": false,
  "editor.indentSize": 2,
  "editor.insertSpaces": true,
  "[typescript]": {
    "editor.defaultFormatter": "biomejs.biome",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.organizeImports.biome": "always"
    }
  }
  // The same block applies to [javascript], [javascriptreact],
  // [typescriptreact], [json], and [jsonc].
}
~~~~

If you prefer [Oxc] over Biome and ESLint, install the [oxc-vscode]
extension and swap the formatter:

~~~~ jsonc [.vscode/settings.json]
{
  "[typescript]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll.oxc": "always"
    }
  }
}
~~~~

[Deno extension]: https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno
[*Set up your environment*]: https://docs.deno.com/runtime/getting_started/setup_your_environment/
[Biome extension]: https://marketplace.visualstudio.com/items?itemName=biomejs.biome
[ESLint extension]: https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint
[Oxc]: https://oxc.rs/
[oxc-vscode]: https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode

### Zed

> [!TIP]
> `fedify init` does not generate *.zed/* configuration; the snippets below
> need to be added by hand.

*For Deno projects*, create *.zed/settings.json* that enables the Deno
language server and uses it as the formatter for TypeScript and JavaScript.
The `!` prefix disables the bundled TypeScript and ESLint servers so they do
not compete with Deno:

~~~~ jsonc [.zed/settings.json]
{
  "lsp": {
    "deno": {
      "settings": { "deno": { "enable": true } }
    }
  },
  "languages": {
    "TypeScript": {
      "formatter": [
        { "language_server": { "name": "deno" } }
      ],
      "language_servers": [
        "deno",
        "!typescript-language-server",
        "!vtsls",
        "!eslint",
        "!biome",
        "..."
      ]
    }
    // The same block applies to TSX and JavaScript.
  }
}
~~~~

Zed's [Deno language docs][zed-deno] cover the available options.
[Hackers' Pub] is a real-world reference.

*For Node.js/Bun projects*, Zed enables its bundled TypeScript language
server out of the box; the typical addition is wiring up Biome (or the
formatter you chose) for `editor.formatOnSave`-style behaviour.  See Zed's
[TypeScript language docs][zed-ts] for setup.  If you prefer [Oxc] instead,
set Oxc as the language server and turn on its fix-all action on format:

~~~~ jsonc [.zed/settings.json]
{
  "language_servers": ["oxc", "..."],
  "code_actions_on_format": {
    "source.fixAll.oxc": true
  }
}
~~~~

[zed-deno]: https://zed.dev/docs/languages/deno
[Hackers' Pub]: https://github.com/hackers-pub/hackerspub/blob/main/.zed/settings.json
[zed-ts]: https://zed.dev/docs/languages/typescript


Linting
-------

`fedify init` configures the [`@fedify/lint`] plugin automatically: Deno
projects pick it up through `lint.plugins` in *deno.json*, and Node.js/Bun
projects through a generated *eslint.config.ts*.  For the full rule list,
configuration options, and how to run the linter, see the
[*Linting*](./manual/lint.md) chapter.

[`@fedify/lint`]: https://jsr.io/@fedify/lint


Agentic skill
-------------

_This skill is available since Fedify 2.2.0._

Fedify ships a [Markdown skill file][SKILL.md] that AI coding assistants such
as [Claude Code], [Codex], or [OpenCode] can load to learn Fedify's APIs,
common pitfalls, and recommended patterns.  The file lives inside the
`@fedify/fedify` package itself, so the only remaining step is exposing it
to your agent's skills directory.

[SKILL.md]: https://github.com/fedify-dev/fedify/blob/main/packages/fedify/skills/fedify/SKILL.md
[Claude Code]: https://claude.com/product/claude-code
[Codex]: https://developers.openai.com/codex
[OpenCode]: https://opencode.ai/

### Node.js/Bun

Use [`skills-npm`], a third-party tool by Anthony Fu (it is not a Fedify
package), that scans *node\_modules* for packages exposing the `agents.skills`
field in their *package.json* and links them into your agent's skills
directory on every install.

1.  Install `skills-npm` as a dev dependency:

    ::: code-group

    ~~~~ sh [npm]
    npm add -D skills-npm
    ~~~~


    ~~~~ sh [pnpm]
    pnpm add -D skills-npm
    ~~~~


    ~~~~ sh [Yarn]
    yarn add -D skills-npm
    ~~~~


    ~~~~ sh [Bun]
    bun add -D skills-npm
    ~~~~

    :::

2.  Add a `prepare` script to your *package.json* so it runs after every
    install:

    ~~~~ json
    {
      "scripts": {
        "prepare": "skills-npm"
      }
    }
    ~~~~

3.  Reinstall once.  The Fedify skill appears at *.claude/skills/fedify/*
    (and similar locations for other supported agents).

The same script picks up other Fedify packages and any third-party npm
packages that adopt the convention.

[`skills-npm`]: https://github.com/antfu/skills-npm

### Deno

> [!NOTE]
> Automated installation for Deno is not available yet, so the skill must be
> installed by hand for the time being.  Future automation through the
> Claude Code plugin marketplace is tracked in
> [issue #489].

1.  Pick your agent's skills directory.  For Claude Code, this is
    *.claude/skills/fedify/*.

2.  Download *SKILL.md* from the Fedify repository:

    ~~~~ sh
    mkdir -p .claude/skills/fedify
    curl -L -o .claude/skills/fedify/SKILL.md \
      https://raw.githubusercontent.com/fedify-dev/fedify/main/packages/fedify/skills/fedify/SKILL.md
    ~~~~

3.  Either commit the file or add it to *.gitignore*, depending on your
    team's preference.

[issue #489]: https://github.com/fedify-dev/fedify/issues/489
