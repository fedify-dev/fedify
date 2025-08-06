<!-- deno-fmt-ignore-file -->

`fedify`: the CLI toolchain for Fedify and debugging ActivityPub
================================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![GitHub Releases][GitHub Releases badge]][GitHub Releases]

The `fedify` is a CLI toolchain for Fedify and debugging ActivityPub-enabled
federated server apps.  Although it is primarily designed for developers who use
[Fedify], it can be used with any ActivityPub-enabled server.

[JSR]: https://jsr.io/@fedify/cli
[JSR badge]: https://jsr.io/badges/@fedify/cli
[npm]: https://www.npmjs.com/package/@fedify/cli
[npm badge]: https://img.shields.io/npm/v/@fedify/cli?logo=npm
[GitHub Releases]: https://github.com/fedify-dev/fedify/releases
[GitHub Releases badge]: https://img.shields.io/github/v/release/fedify-dev/fedify?sort=semver&logo=github
[Fedify]: https://fedify.dev/


Installation
------------

### Using npm

If you have npm installed, you can install `fedify` by running the following
command:

~~~~ sh
npm install -g @fedify/cli
~~~~

### Using Bun

If you have [Bun] installed, you can install `fedify` by running the following
command:

~~~~ sh [Bun]
bun install -g @fedify/cli
~~~~

[Bun]: https://bun.sh/

### Using Deno

If you have [Deno] installed, you can install `fedify` by running the following
command:

~~~~ sh
# Linux/macOS
deno install \
  -A \
  --unstable-fs --unstable-kv --unstable-temporal \
  -n fedify \
  jsr:@fedify/cli
~~~~

~~~~ powershell
# Windows
deno install `
  -A `
  --unstable-fs --unstable-kv --unstable-temporal `
  -n fedify `
  jsr:@fedify/cli
~~~~

[Deno]: https://deno.com/

### Downloading the executable

You can download the pre-built executables from the [releases] page.  Download
the appropriate executable for your platform and put it in your `PATH`.

[releases]: https://github.com/fedify-dev/fedify/releases
