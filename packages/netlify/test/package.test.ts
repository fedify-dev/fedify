import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import process from "node:process";
import { fileURLToPath } from "node:url";

const canRunTypeScript = !("Deno" in globalThis);

describe("package exports", () => {
  it("loads the ESM distribution", async () => {
    const module = await import("../dist/mod.js");
    assert.equal(typeof module.NetlifyMessageQueue, "function");
    assert.equal(typeof module.createNetlifyQueueHandler, "function");
  });

  it("loads the CommonJS distribution", () => {
    const require = createRequire(import.meta.url);
    const module = require("../dist/mod.cjs");
    assert.equal(typeof module.NetlifyMessageQueue, "function");
    assert.equal(typeof module.createNetlifyQueueHandler, "function");
  });

  it("accepts the Netlify Blobs Store in the public types", {
    skip: !canRunTypeScript,
    timeout: 60_000,
  }, () => {
    const require = createRequire(import.meta.url);
    const tsc = require.resolve("typescript/bin/tsc");
    const fixture = fileURLToPath(
      new URL("../fixtures/public-types.ts", import.meta.url),
    );

    execFileSync(process.execPath, [
      tsc,
      "--noEmit",
      "--strict",
      "--types",
      "node",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ESNext",
      fixture,
    ], { timeout: 55_000 });
  });
});
