import { parse } from "@optique/core/parser";
import { ok, strictEqual } from "node:assert/strict";
import test from "node:test";
import { isSkipInstall } from "./action/utils.ts";
import { initOptions } from "./command.ts";

test("initOptions parses --skip-install as true", () => {
  const result = parse(initOptions, ["--skip-install"]);
  ok(result.success);
  if (result.success) {
    strictEqual(result.value.skipInstall, true);
  }
});

test("initOptions defaults skipInstall to false when the flag is absent", () => {
  const result = parse(initOptions, []);
  ok(result.success);
  if (result.success) {
    strictEqual(result.value.skipInstall, false);
  }
});

test("isSkipInstall mirrors the skipInstall field", () => {
  strictEqual(isSkipInstall({ skipInstall: false }), false);
  strictEqual(isSkipInstall({ skipInstall: true }), true);
});
