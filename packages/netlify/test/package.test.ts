import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
});
