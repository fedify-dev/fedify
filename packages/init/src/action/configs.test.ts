import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { message } from "@optique/core";
import { kvStores, messageQueues, PACKAGE_VERSION } from "../lib.ts";
import type { InitCommandData } from "../types.ts";
import bareBonesDescription from "../webframeworks/bare-bones.ts";
import astroDescription from "../webframeworks/astro.ts";
import nextDescription from "../webframeworks/next.ts";
import nitroDescription from "../webframeworks/nitro.ts";
import nuxtDescription from "../webframeworks/nuxt.ts";
import { cleanupScaffoldedFiles } from "./cleanup.ts";
import { loadDenoConfig } from "./configs.ts";
import { patchFiles } from "./patch.ts";

const execFileAsync = promisify(execFile);

function createInitData(): InitCommandData {
  const data = {
    command: "init",
    projectName: "example",
    packageManager: "deno",
    webFramework: "hono",
    kvStore: "denokv",
    messageQueue: "denokv",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir: "/tmp/example",
    initializer: {
      federationFile: "federation.ts",
      loggingFile: "logging.ts",
      instruction: message`done`,
      tasks: {},
      compilerOptions: {},
    },
    kv: {
      label: "Deno KV",
      packageManagers: ["deno"],
      imports: {},
      object: "kv",
      denoUnstable: [],
    },
    mq: {
      label: "Deno KV",
      packageManagers: ["deno"],
      imports: {},
      object: "mq",
      denoUnstable: [],
    },
    env: {},
  } satisfies InitCommandData;
  return data;
}

function restoreDeno(
  originalDeno: unknown,
) {
  if (originalDeno == null) {
    Reflect.deleteProperty(globalThis, "Deno");
  } else {
    Object.defineProperty(globalThis, "Deno", {
      value: originalDeno,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
}

function setDenoVersion(
  version: { deno: string; v8: string; typescript: string },
) {
  const current = (globalThis as Record<string, unknown>).Deno;
  const value = current == null || typeof current !== "object"
    ? { version }
    : { ...(current as Record<string, unknown>), version };
  Object.defineProperty(globalThis, "Deno", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

test("loadDenoConfig omits unstable.temporal on Deno 2.7.0", () => {
  const originalDeno = (globalThis as Record<string, unknown>).Deno;
  setDenoVersion({ deno: "2.7.0", v8: "0.0.0", typescript: "0.0.0" });

  try {
    const config = loadDenoConfig(createInitData()).data;
    assert.strictEqual(config.unstable, undefined);
  } finally {
    restoreDeno(originalDeno);
  }
});

test("loadDenoConfig keeps unstable.temporal before Deno 2.7.0", () => {
  const originalDeno = (globalThis as Record<string, unknown>).Deno;
  setDenoVersion({ deno: "2.6.9", v8: "0.0.0", typescript: "0.0.0" });

  try {
    const config = loadDenoConfig(createInitData()).data;
    assert.deepStrictEqual(config.unstable, ["temporal"]);
  } finally {
    restoreDeno(originalDeno);
  }
});

test("loadDenoConfig uses npm for Astro Fedify adapters", async () => {
  const initializer = await astroDescription.init({
    command: "init",
    projectName: "example",
    packageManager: "deno",
    webFramework: "astro",
    kvStore: "redis",
    messageQueue: "amqp",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir: "/tmp/example",
  });
  const config = loadDenoConfig({
    ...createInitData(),
    webFramework: "astro",
    kvStore: "redis",
    messageQueue: "amqp",
    initializer,
    kv: kvStores.redis,
    mq: messageQueues.amqp,
  }).data;

  assert.strictEqual(
    config.imports["@fedify/redis"],
    `npm:@fedify/redis@${PACKAGE_VERSION}`,
  );
  assert.strictEqual(
    config.imports["@fedify/amqp"],
    `npm:@fedify/amqp@${PACKAGE_VERSION}`,
  );
  assert.strictEqual(
    config.imports["@fedify/lint"],
    `jsr:@fedify/lint@${PACKAGE_VERSION}`,
  );
});

test("patchFiles creates Oxfmt and Oxlint configs for npm projects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-oxc-"));

  try {
    const data = await createNpmInitData(dir);
    await patchFiles(data);

    const packageJson = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const oxfmtConfig = JSON.parse(
      await readFile(join(dir, ".oxfmtrc.json"), "utf8"),
    ) as {
      $schema?: string;
      ignorePatterns?: string[];
      sortPackageJson?: boolean;
      tabWidth?: number;
    };
    const oxlintConfig = JSON.parse(
      await readFile(join(dir, ".oxlintrc.json"), "utf8"),
    ) as {
      ignorePatterns?: string[];
      jsPlugins?: string[];
      rules?: Record<string, string>;
    };
    const vscodeExtensions = JSON.parse(
      await readFile(join(dir, ".vscode", "extensions.json"), "utf8"),
    ) as {
      recommendations?: string[];
    };

    assert.equal(packageJson.scripts?.format, "oxfmt");
    assert.equal(packageJson.scripts?.["format:check"], "oxfmt --check");
    assert.equal(packageJson.scripts?.lint, "oxlint .");
    assert.ok(packageJson.devDependencies?.["@fedify/lint"]);
    assert.ok(packageJson.devDependencies?.["oxfmt"]);
    assert.ok(packageJson.devDependencies?.["oxlint"]);
    assert.equal(packageJson.devDependencies?.["eslint"], undefined);
    assert.equal(packageJson.devDependencies?.["@biomejs/biome"], undefined);
    assert.equal(
      oxfmtConfig.$schema,
      "./node_modules/oxfmt/configuration_schema.json",
    );
    assert.equal(oxfmtConfig.sortPackageJson, false);
    assert.equal(oxfmtConfig.tabWidth, 2);
    assert.deepEqual(oxfmtConfig.ignorePatterns, [
      "**/*.md",
      "build/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
    ]);
    assert.deepEqual(oxlintConfig.ignorePatterns, oxfmtConfig.ignorePatterns);
    assert.deepEqual(oxlintConfig.jsPlugins, ["@fedify/lint/oxlint"]);
    assert.equal(
      oxlintConfig.rules?.["@fedify/lint/actor-id-required"],
      "error",
    );
    assert.equal(
      oxlintConfig.rules?.["@fedify/lint/actor-outbox-property-required"],
      "warn",
    );
    assert.deepEqual(vscodeExtensions.recommendations, ["oxc.oxc-vscode"]);
    await assert.rejects(readFile(join(dir, "biome.json"), "utf8"), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(join(dir, "eslint.config.ts"), "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patchFiles keeps generated Deno federation file formatted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-deno-fmt-"));

  try {
    const data = await createDenoInitData(dir);
    await patchFiles(data);

    await execFileAsync("deno", [
      "fmt",
      "--check",
      join(dir, "src", "federation.ts"),
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patchFiles adds framework-specific Oxc ignore patterns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-next-oxc-"));

  try {
    const data = await createNextNpmInitData(dir);
    await patchFiles(data);

    const oxfmtConfig = JSON.parse(
      await readFile(join(dir, ".oxfmtrc.json"), "utf8"),
    ) as {
      ignorePatterns?: string[];
    };
    const oxlintConfig = JSON.parse(
      await readFile(join(dir, ".oxlintrc.json"), "utf8"),
    ) as {
      ignorePatterns?: string[];
    };

    assert.deepEqual(oxfmtConfig.ignorePatterns, [
      "**/*.md",
      ".next/**",
      "build/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
    ]);
    assert.deepEqual(oxlintConfig.ignorePatterns, oxfmtConfig.ignorePatterns);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patchFiles omits Oxfmt config for Astro npm projects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-astro-prettier-"));

  try {
    const data = await createAstroNpmInitData(dir);
    await patchFiles(data);

    const packageJson = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const vscodeSettings = JSON.parse(
      await readFile(join(dir, ".vscode", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
    const vscodeExtensions = JSON.parse(
      await readFile(join(dir, ".vscode", "extensions.json"), "utf8"),
    ) as {
      recommendations?: string[];
    };
    assert.equal(
      packageJson.scripts?.format,
      "prettier --plugin prettier-plugin-astro --write .",
    );
    assert.equal(
      packageJson.scripts?.["format:check"],
      "prettier --plugin prettier-plugin-astro --check .",
    );
    assert.equal(packageJson.scripts?.lint, "oxlint .");
    assert.ok(packageJson.devDependencies?.["prettier"]);
    assert.ok(packageJson.devDependencies?.["prettier-plugin-astro"]);
    assert.equal(packageJson.devDependencies?.["oxfmt"], undefined);
    assert.ok(packageJson.devDependencies?.["oxlint"]);
    await assert.rejects(readFile(join(dir, ".oxfmtrc.json"), "utf8"), {
      code: "ENOENT",
    });
    assert.equal(vscodeSettings["oxc.fmt.configPath"], undefined);
    assert.deepEqual(vscodeSettings["[astro]"], {
      "editor.defaultFormatter": "esbenp.prettier-vscode",
      "editor.formatOnSave": true,
    });
    for (
      const language of [
        "[javascript]",
        "[javascriptreact]",
        "[json]",
        "[jsonc]",
        "[typescript]",
        "[typescriptreact]",
      ]
    ) {
      assert.equal(
        (vscodeSettings[language] as Record<string, unknown>)[
          "editor.defaultFormatter"
        ],
        "esbenp.prettier-vscode",
      );
    }
    assert.deepEqual(vscodeExtensions.recommendations, [
      "astro-build.astro-vscode",
      "esbenp.prettier-vscode",
      "oxc.oxc-vscode",
    ]);
    await readFile(join(dir, ".oxlintrc.json"), "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanupScaffoldedFiles removes Next.js ESLint artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-next-cleanup-"));

  try {
    const data = await createNextNpmInitData(dir);
    await writeFile(join(dir, "eslint.config.mjs"), "export default [];\n");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "next dev",
          lint: "eslint",
        },
        devDependencies: {
          eslint: "^9",
          "eslint-config-next": "16.2.9",
          typescript: "^5",
        },
      }),
    );

    await cleanupScaffoldedFiles(data);

    const packageJson = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.equal(packageJson.scripts?.dev, "next dev");
    assert.equal(packageJson.scripts?.lint, undefined);
    assert.equal(packageJson.devDependencies?.eslint, undefined);
    assert.equal(
      packageJson.devDependencies?.["eslint-config-next"],
      undefined,
    );
    assert.equal(packageJson.devDependencies?.typescript, "^5");
    await assert.rejects(readFile(join(dir, "eslint.config.mjs"), "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanupScaffoldedFiles ignores empty cleanup file paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-cleanup-empty-"));

  try {
    const data = await createNpmInitData(dir);
    data.initializer.cleanupFiles = ["", "   ", "generated.txt"];
    await writeFile(join(dir, "generated.txt"), "generated\n");
    await writeFile(join(dir, "keep.txt"), "keep\n");

    await cleanupScaffoldedFiles(data);

    assert.equal(await readFile(join(dir, "keep.txt"), "utf8"), "keep\n");
    await assert.rejects(readFile(join(dir, "generated.txt"), "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanupScaffoldedFiles ignores empty package.json cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-cleanup-empty-pkg-"));

  try {
    const data = await createNpmInitData(dir);
    data.initializer.cleanupPackageJson = {};
    const originalPackageJson = '{ "scripts": { "dev": "vite" } }\n';
    await writeFile(join(dir, "package.json"), originalPackageJson);

    await cleanupScaffoldedFiles(data);

    assert.equal(
      await readFile(join(dir, "package.json"), "utf8"),
      originalPackageJson,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanupScaffoldedFiles rejects cleanup path traversal", async () => {
  const parent = await mkdtemp(join(tmpdir(), "fedify-init-cleanup-parent-"));
  const dir = join(parent, "project");

  try {
    await mkdir(dir);
    const data = await createNpmInitData(dir);
    data.initializer.cleanupFiles = ["../outside.txt"];
    await writeFile(join(parent, "outside.txt"), "outside\n");

    await assert.rejects(
      cleanupScaffoldedFiles(data),
      new Error("Cleanup path escapes project directory: ../outside.txt"),
    );
    assert.equal(
      await readFile(join(parent, "outside.txt"), "utf8"),
      "outside\n",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("cleanupScaffoldedFiles rejects project directory cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-cleanup-root-"));

  try {
    const data = await createNpmInitData(dir);
    data.initializer.cleanupFiles = ["."];
    await writeFile(join(dir, "keep.txt"), "keep\n");

    await assert.rejects(
      cleanupScaffoldedFiles(data),
      new Error("Cleanup path escapes project directory: ."),
    );
    assert.equal(await readFile(join(dir, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cleanupScaffoldedFiles removes Nitro lint artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-nitro-cleanup-"));

  try {
    const data = await createNitroNpmInitData(dir);
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: {
          eslint: "^9",
          "eslint-config-unjs": "^0.5.0",
          prettier: "^3",
          typescript: "^5",
        },
      }),
    );

    await cleanupScaffoldedFiles(data);

    const packageJson = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
    };
    assert.equal(packageJson.devDependencies?.eslint, undefined);
    assert.equal(
      packageJson.devDependencies?.["eslint-config-unjs"],
      undefined,
    );
    assert.equal(packageJson.devDependencies?.prettier, undefined);
    assert.equal(packageJson.devDependencies?.typescript, "^5");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patchFiles preserves Nitro's generated tsconfig extends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-nitro-tsconfig-"));

  try {
    const data = await createNitroNpmInitData(dir);
    await writeFile(
      join(dir, "tsconfig.json"),
      `{
  // https://nitro.build/guide/typescript
  "extends": "./.nitro/types/tsconfig.json",
  "compilerOptions": {
    "types": [
      "node", // runtime types
    ],
    "paths": {
      "~/api/*": ["./server/api/*"],
    }, /* aliases */
  },
  "metadata": {
    "homepage": "https://example.com/docs",
    "commentPattern": "keep // this and /* this */ text", // string remains
  },
}
`,
    );

    await cleanupScaffoldedFiles(data);
    await patchFiles(data);

    const tsconfig = JSON.parse(
      await readFile(join(dir, "tsconfig.json"), "utf8"),
    ) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
    assert.equal(tsconfig.extends, "./.nitro/types/tsconfig.json");
    assert.deepEqual(tsconfig.compilerOptions?.types, ["node"]);
    const paths = tsconfig.compilerOptions?.paths as
      | Record<string, unknown>
      | undefined;
    assert.deepEqual(paths?.["~/api/*"], ["./server/api/*"]);
    assert.equal(tsconfig.compilerOptions?.moduleResolution, "Bundler");
    assert.equal(tsconfig.metadata?.homepage, "https://example.com/docs");
    assert.equal(
      tsconfig.metadata?.commentPattern,
      "keep // this and /* this */ text",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patchFiles wires Nuxt logging through a Nitro plugin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-nuxt-"));

  try {
    const data = await createNuxtNpmInitData(dir);
    await patchFiles(data);

    const logging = await readFile(join(dir, "server/logging.ts"), "utf8");
    const plugin = await readFile(
      join(dir, "server/plugins/logging.ts"),
      "utf8",
    );

    assert.match(logging, /export default configure\(/);
    assert.doesNotMatch(logging, /await configure\(/);
    assert.match(plugin, /import loggingConfigured from "\.\.\/logging";/);
    assert.match(plugin, /await loggingConfigured;/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createNpmInitData(dir: string): Promise<InitCommandData> {
  const initializer = await bareBonesDescription.init({
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "bare-bones",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
  });

  const data = {
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "bare-bones",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
    initializer,
    kv: kvStores["in-memory"],
    mq: messageQueues["in-process"],
    env: {},
  } satisfies InitCommandData;
  return data;
}

async function createAstroNpmInitData(dir: string): Promise<InitCommandData> {
  const initializer = await astroDescription.init({
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "astro",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
  });

  const data = {
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "astro",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
    initializer,
    kv: kvStores["in-memory"],
    mq: messageQueues["in-process"],
    env: {},
  } satisfies InitCommandData;
  return data;
}

async function createDenoInitData(dir: string): Promise<InitCommandData> {
  const initializer = await bareBonesDescription.init({
    command: "init",
    projectName: "example",
    packageManager: "deno",
    webFramework: "bare-bones",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
  });

  const data = {
    command: "init",
    projectName: "example",
    packageManager: "deno",
    webFramework: "bare-bones",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
    initializer,
    kv: kvStores["in-memory"],
    mq: messageQueues["in-process"],
    env: {},
  } satisfies InitCommandData;
  return data;
}

async function createNextNpmInitData(dir: string): Promise<InitCommandData> {
  const initializer = await nextDescription.init({
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "next",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
  });

  const data = {
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "next",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
    initializer,
    kv: kvStores["in-memory"],
    mq: messageQueues["in-process"],
    env: {},
  } satisfies InitCommandData;
  return data;
}

async function createNitroNpmInitData(dir: string): Promise<InitCommandData> {
  const initializer = await nitroDescription.init({
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "nitro",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
  });

  const data = {
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "nitro",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
    initializer,
    kv: kvStores["in-memory"],
    mq: messageQueues["in-process"],
    env: {},
  } satisfies InitCommandData;
  return data;
}

async function createNuxtNpmInitData(dir: string): Promise<InitCommandData> {
  const initializer = await nuxtDescription.init({
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "nuxt",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
  });

  const data = {
    command: "init",
    projectName: "example",
    packageManager: "npm",
    webFramework: "nuxt",
    kvStore: "in-memory",
    messageQueue: "in-process",
    dryRun: false,
    allowNonEmpty: false,
    skipInstall: false,
    testMode: false,
    dir,
    initializer,
    kv: kvStores["in-memory"],
    mq: messageQueues["in-process"],
    env: {},
  } satisfies InitCommandData;
  return data;
}
