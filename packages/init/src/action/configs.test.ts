import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { message } from "@optique/core";
import { kvStores, messageQueues } from "../lib.ts";
import type { InitCommandData } from "../types.ts";
import bareBonesDescription from "../webframeworks/bare-bones.ts";
import { loadDenoConfig } from "./configs.ts";
import { patchFiles } from "./patch.ts";

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

test("patchFiles creates a Biome config matching the npm package version", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-biome-"));

  try {
    const data = await createNpmInitData(dir);
    await patchFiles(data);

    const packageJson = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
    };
    const biomeConfig = JSON.parse(
      await readFile(join(dir, "biome.json"), "utf8"),
    ) as Record<string, unknown>;

    const biomeVersion = packageJson.devDependencies?.["@biomejs/biome"];
    const schema = biomeConfig.$schema;
    assert.ok(typeof biomeVersion === "string");
    assert.ok(typeof schema === "string");
    assert.equal(getSchemaVersion(schema), getPackageVersion(biomeVersion));
    assert.equal(getOrganizeImportsSetting(biomeConfig), "on");
    assert.equal(
      "organizeImports" in biomeConfig,
      false,
    );
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
    testMode: false,
    dir,
    initializer,
    kv: kvStores["in-memory"],
    mq: messageQueues["in-process"],
    env: {},
  } satisfies InitCommandData;
  return data;
}

function getSchemaVersion(schema: string): string {
  const match = schema.match(/\/schemas\/(\d+\.\d+\.\d+)\//);
  assert.ok(match, `Unexpected Biome schema URL: ${schema}`);
  return match[1];
}

function getPackageVersion(version: string): string {
  const match = version.match(/\d+\.\d+\.\d+/);
  assert.ok(match, `Unexpected Biome package version: ${version}`);
  return match[0];
}

function getOrganizeImportsSetting(config: Record<string, unknown>): unknown {
  const assist = config.assist;
  assert.ok(isRecord(assist));
  const actions = assist.actions;
  assert.ok(isRecord(actions));
  const source = actions.source;
  assert.ok(isRecord(source));
  return source.organizeImports;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}
