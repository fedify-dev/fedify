import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCliArgs } from "./mod.ts";

describe("parseCliArgs", () => {
  it("uses the documented default timeout", () => {
    const options = parseCliArgs([]);

    strictEqual(options.defaultTimeoutMs, 10_000);
    strictEqual(options.debugMode, false);
    deepStrictEqual([...options.filterNames], []);
  });

  it("honors --timeout with a separate value", () => {
    const options = parseCliArgs(["--timeout", "2500", "hono-sample"]);

    strictEqual(options.defaultTimeoutMs, 2500);
    strictEqual(options.debugMode, false);
    deepStrictEqual([...options.filterNames], ["hono-sample"]);
  });

  it("honors --timeout=value and debug aliases", () => {
    const options = parseCliArgs([
      "--timeout=1500",
      "-d",
      "express",
      "koa",
    ]);

    strictEqual(options.defaultTimeoutMs, 1500);
    strictEqual(options.debugMode, true);
    deepStrictEqual([...options.filterNames], ["express", "koa"]);
  });

  it("ignores invalid timeout values without skipping flags", () => {
    const options = parseCliArgs([
      "--timeout",
      "--debug",
      "--timeout=",
      "--timeout=-1",
      "express",
    ]);

    strictEqual(options.defaultTimeoutMs, 10_000);
    strictEqual(options.debugMode, true);
    deepStrictEqual([...options.filterNames], ["express"]);
  });
});
