import assert from "node:assert/strict";
import test from "node:test";
import type { InitCommandData } from "../types.ts";
import { loadDenoConfig } from "./configs.ts";

function createInitData(): InitCommandData {
  return {
    projectName: "example",
    packageManager: "deno",
    webFramework: "hono",
    kvStore: "denokv",
    messageQueue: "denokv",
    skipInstall: false,
    devcontainer: false,
    dryRun: false,
    testMode: false,
    dir: "/tmp/example",
    projectDir: "/tmp/example",
    projectNameOption: undefined,
    initializer: {
      federationFile: "federation.ts",
      loggingFile: "logging.ts",
      instruction: "done" as never,
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
  } as unknown as InitCommandData;
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

test("loadDenoConfig omits unstable.temporal on Deno 2.7.0 and newer", () => {
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
