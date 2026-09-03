import { defineConfig } from "tsdown";

/**
 * Build configuration for `@fedify/adonisjs`, following the Fedify
 * integration-package template: dual ESM + CommonJS output with `.cjs` /
 * `.d.cts` extensions for the CommonJS half, and declaration files built with
 * `isolatedDeclarations`.
 *
 * The CommonJS build is real, not decorative.  `@adonisjs/core` is published as
 * ESM only, but this package requires Node.js >= 24, where `require()` of an
 * ESM graph without top-level await is fully supported — and every module here
 * is written without top-level await for exactly that reason.  The test suite
 * loads each `.cjs` entry through `createRequire` to keep that true.
 *
 * One deviation from the template: multiple entry points instead of a single
 * `src/mod.ts`.  AdonisJS packages expose their provider, middleware and
 * container services through dedicated subpath exports so that `adonisrc.ts`
 * and `start/kernel.ts` can lazily import exactly one module (see
 * `@adonisjs/cors` for the canonical example).  The layout follows the
 * AdonisJS package starter kit and the official packages: `providers/` for the
 * service provider, `services/` for container service modules (as in
 * `@adonisjs/core/services/*`), `src/` for everything else.  `stubs/main.ts`
 * is an entry because `configure.ts` resolves the stub templates relative to
 * the compiled location of that module.
 */
export default defineConfig({
  entry: [
    "index.ts",
    "configure.ts",
    "src/types.ts",
    "src/builder.ts",
    "src/define_config.ts",
    "src/errors.ts",
    "src/fedify_middleware.ts",
    "src/http_context.ts",
    "providers/fedify_provider.ts",
    "services/builder.ts",
    "stubs/main.ts",
  ],
  outDir: "dist",
  platform: "node",
  format: ["esm", "cjs"],
  target: "esnext",
  outExtensions({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
      dts: format === "cjs" ? ".d.cts" : ".d.ts",
    };
  },
  dts: {
    compilerOptions: {
      isolatedDeclarations: true,
      declaration: true,
    },
  },
  outputOptions: {
    exports: "named",
  },
  // The stub templates are data, not modules, so nothing imports them and the
  // bundler would not otherwise emit them.  `configure.ts` resolves them through
  // `stubsRoot` from the compiled `stubs/main.js`, so they have to land in
  // `dist/stubs/` with their directory structure intact.  The glob deliberately
  // matches only `*.stub`: `stubs/main.ts` is an entry point and is compiled,
  // not copied.
  // `flatten` defaults to true, which would collapse `config/fedify.stub` and
  // `federation/main.stub` into a single directory and break both lookups.  With
  // it off, paths are preserved relative to the glob's base (`stubs/`), so `to`
  // has to name `dist/stubs` — which is what `stubsRoot` resolves to, being the
  // directory of the compiled `stubs/main.js`.
  copy: [{ from: "stubs/**/*.stub", to: "dist/stubs", flatten: false }],
  // Keep the emitted files readable: this package is meant to be studied by
  // people who want to write their own AdonisJS integrations.
  minify: false,
  treeshake: false,
  sourcemap: true,
  // Cleaning here rather than in a separate `clean` step keeps `build:self` a
  // single self-contained command, which is what the monorepo's `mise run
  // prepare` invokes.  Without it, a renamed or removed entry point would leave
  // a stale artefact behind for `src/dist.test.ts` to load and pass on.
  clean: true,
  unbundle: true,
});
