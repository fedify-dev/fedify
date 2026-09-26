// Regression check for Temporal packaging in published artifacts.
//
// The packages below publish files that use Temporal.  Their CommonJS outputs
// must be self-contained because temporal-polyfill cannot be required directly
// from CJS consumers, and declaration files should expose only the standard
// esnext.temporal library reference rather than polyfill-specific imports.
// The final type-consumer checks make sure the generated declarations work
// under the TypeScript module resolution modes used by modern app templates.
// The consumer projects use the repository root's @types/node and typescript.

import { join } from "node:path";

const root = Deno.cwd();

const packages = [
  "cli",
  "debugger",
  "fedify",
  "mysql",
  "pglite",
  "postgres",
  "redis",
  "relay",
  "sqlite",
  "testing",
  "vocab",
] as const;

// @fedify/cli is still scanned above, but it does not expose a library type
// surface for TypeScript consumers.
const typeConsumerPackages = packages.filter((pkg) => pkg !== "cli");

const forbiddenCjsRequires = [
  `require("@js-temporal/polyfill")`,
  `require('@js-temporal/polyfill')`,
  `require("temporal-polyfill")`,
  `require('temporal-polyfill')`,
];

const forbiddenDeclarationText = [
  "@js-temporal/polyfill",
  "temporal-polyfill",
  "temporal-spec",
];

async function* walk(dir: string): AsyncGenerator<string> {
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        yield* walk(path);
      } else if (entry.isFile) {
        yield path;
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

let failures = 0;

const depsHint = "Run `mise deps` first.";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function findTypeScriptCompiler(): Promise<string> {
  const typescriptDir = join(root, "node_modules", "typescript");
  const tsc = join(typescriptDir, "bin", "tsc");
  if (!await exists(tsc)) {
    throw new Error(
      `Could not find the TypeScript compiler at ${tsc}.  ${depsHint}`,
    );
  }
  // TypeScript 6 is the first release that ships the esnext.temporal lib the
  // generated declarations reference; older compilers bury that fact under
  // hundreds of unrelated errors.
  if (!await exists(join(typescriptDir, "lib", "lib.esnext.temporal.d.ts"))) {
    throw new Error(
      `The TypeScript compiler at ${tsc} does not provide the ` +
        `esnext.temporal lib; TypeScript 6 or later is required.  ${depsHint}`,
    );
  }
  return tsc;
}

const nodeTypesDir = join(root, "node_modules", "@types", "node");
if (!await exists(join(nodeTypesDir, "package.json"))) {
  throw new Error(
    `Could not find @types/node at ${nodeTypesDir}.  ${depsHint}`,
  );
}
const tsc = await findTypeScriptCompiler();

for (const pkg of packages) {
  const dist = `packages/${pkg}/dist`;
  const files = [];
  for await (const file of walk(dist)) files.push(file);
  if (files.length < 1) {
    console.error(`Missing build output: ${dist}`);
    failures++;
    continue;
  }

  for (const file of files) {
    if (file.includes(".test.")) continue;
    if (
      !file.endsWith(".js") &&
      !file.endsWith(".cjs") &&
      !file.endsWith(".d.ts") &&
      !file.endsWith(".d.cts")
    ) {
      continue;
    }

    const text = await Deno.readTextFile(file);
    if (file.endsWith(".cjs")) {
      for (const forbidden of forbiddenCjsRequires) {
        if (text.includes(forbidden)) {
          console.error(`${file} contains forbidden ${forbidden}`);
          failures++;
        }
      }
    } else if (file.endsWith(".d.ts") || file.endsWith(".d.cts")) {
      for (const forbidden of forbiddenDeclarationText) {
        if (text.includes(forbidden)) {
          console.error(`${file} exposes ${forbidden}`);
          failures++;
        }
      }
      if (
        /\bTemporal\b/.test(text) &&
        !text.includes(`/// <reference lib="esnext.temporal" />`)
      ) {
        console.error(`${file} is missing the Temporal lib reference`);
        failures++;
      }
    }
  }
}

async function prepareTypeConsumerProject(
  name: string,
  compilerOptions: Record<string, unknown>,
  sourceFile: string,
): Promise<string> {
  await Deno.mkdir(join(root, "tmp"), { recursive: true });
  const dir = await Deno.makeTempDir({
    dir: join(root, "tmp"),
    prefix: `temporal-polyfill-${name}-`,
  });
  const symlinkType = Deno.build.os === "windows" ? "junction" : "dir";
  await Deno.mkdir(join(dir, "node_modules", "@fedify"), { recursive: true });
  for (const pkg of typeConsumerPackages) {
    // Symlink the package root so package.json exports resolve to the dist
    // artifacts produced by the earlier build check.
    await Deno.symlink(
      join(root, "packages", pkg),
      join(dir, "node_modules", "@fedify", pkg),
      { type: symlinkType },
    );
  }
  // Link the repository's pinned @types/node the same way an app template
  // installs it, so `types: ["node"]` never depends on an ancestor directory.
  await Deno.mkdir(join(dir, "node_modules", "@types"), { recursive: true });
  await Deno.symlink(
    nodeTypesDir,
    join(dir, "node_modules", "@types", "node"),
    { type: symlinkType },
  );
  await Deno.writeTextFile(
    join(dir, "package.json"),
    `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`,
  );
  await Deno.writeTextFile(
    join(dir, "tsconfig.json"),
    `${
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            lib: ["ESNext", "ESNext.Temporal", "DOM"],
            types: ["node"],
            ...compilerOptions,
          },
          include: [sourceFile],
        },
        null,
        2,
      )
    }\n`,
  );
  await Deno.writeTextFile(
    join(dir, sourceFile),
    `
      import { Object as ActivityObject } from "@fedify/vocab";

      import type * as debuggerModule from "@fedify/debugger";
      import type * as fedify from "@fedify/fedify";
      import type * as mysql from "@fedify/mysql";
      import type * as pglite from "@fedify/pglite";
      import type * as postgres from "@fedify/postgres";
      import type * as redis from "@fedify/redis";
      import type * as relay from "@fedify/relay";
      import type * as sqlite from "@fedify/sqlite";
      import type * as testing from "@fedify/testing";
      import type * as vocab from "@fedify/vocab";

      const instant: Temporal.Instant = Temporal.Instant.from(
        "2025-01-01T00:00:00Z",
      );
      const object = new ActivityObject({ published: instant });

      const modules: [
        typeof debuggerModule | undefined,
        typeof fedify | undefined,
        typeof mysql | undefined,
        typeof pglite | undefined,
        typeof postgres | undefined,
        typeof redis | undefined,
        typeof relay | undefined,
        typeof sqlite | undefined,
        typeof testing | undefined,
        typeof vocab | undefined,
      ] = [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ];

      void object;
      void modules;
    `,
  );
  return dir;
}

async function checkTypeConsumerProject(
  name: string,
  compilerOptions: Record<string, unknown>,
  sourceFile: string,
): Promise<void> {
  const dir = await prepareTypeConsumerProject(
    name,
    compilerOptions,
    sourceFile,
  );
  try {
    const command = new Deno.Command(
      "node",
      {
        args: [tsc, "-p", "tsconfig.json"],
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
      },
    );
    const result = await command.output();
    if (!result.success) {
      const decoder = new TextDecoder();
      console.error(`TypeScript ${name} consumer check failed.`);
      console.error(decoder.decode(result.stdout));
      console.error(decoder.decode(result.stderr));
      failures++;
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

await checkTypeConsumerProject(
  "bundler",
  { module: "ESNext", moduleResolution: "Bundler" },
  "index.ts",
);
await checkTypeConsumerProject(
  "nodenext",
  { module: "NodeNext", moduleResolution: "NodeNext" },
  "index.mts",
);

if (failures > 0) Deno.exit(1);
