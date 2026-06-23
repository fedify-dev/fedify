import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { message } from "@optique/core";
import { kvStores, messageQueues } from "../lib.ts";
import type { InitCommandData } from "../types.ts";
import bareBonesDescription from "../webframeworks/bare-bones.ts";
import nextDescription from "../webframeworks/next.ts";
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
    assert.ok(oxfmtConfig.ignorePatterns?.includes("node_modules/**"));
    assert.ok(oxfmtConfig.ignorePatterns?.includes("**/*.md"));
    assert.ok(oxlintConfig.ignorePatterns?.includes("node_modules/**"));
    assert.ok(oxlintConfig.ignorePatterns?.includes("**/*.md"));
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
