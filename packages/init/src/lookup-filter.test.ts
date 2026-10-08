import { deepStrictEqual } from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  isTestable,
  matchesLookupCasePattern,
  parseLookupCase,
} from "./test/lookup.ts";

test("parseLookupCase() parses the last four path segments", () => {
  deepStrictEqual(
    parseLookupCase(join("/tmp", "cases", "hono", "deno", "denokv", "redis")),
    ["hono", "deno", "denokv", "redis"],
  );
});

test("matchesLookupCasePattern() supports wildcards", () => {
  deepStrictEqual(
    matchesLookupCasePattern(["solidstart", "deno", "postgres", "redis"])(
      ["solidstart", "deno", "*", "*"],
    ),
    true,
  );
  deepStrictEqual(
    matchesLookupCasePattern(["solidstart", "npm", "postgres", "redis"])(
      ["solidstart", "deno", "*", "*"],
    ),
    false,
  );
});

test("isTestable() excludes banned lookup cases only", () => {
  const dirs = [
    join("/tmp", "hyd", "next", "pnpm", "postgres", "redis"),
    join("/tmp", "hyd", "solidstart", "deno", "postgres", "redis"),
    join("/tmp", "hyd", "solidstart", "npm", "postgres", "redis"),
    join("/tmp", "hyd", "hono", "deno", "denokv", "denokv"),
  ];

  deepStrictEqual(
    dirs.filter(isTestable),
    [
      join("/tmp", "hyd", "solidstart", "npm", "postgres", "redis"),
      join("/tmp", "hyd", "hono", "deno", "denokv", "denokv"),
    ],
  );
});
