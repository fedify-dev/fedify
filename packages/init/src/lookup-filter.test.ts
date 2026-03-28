import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { test } from "node:test";
import {
  isTestable,
  matchesLookupCasePattern,
  parseLookupCase,
} from "./test/lookup.ts";

test("parseLookupCase() parses the last four path segments", () => {
  assertEquals(
    parseLookupCase(join("/tmp", "cases", "hono", "deno", "denokv", "redis")),
    ["hono", "deno", "denokv", "redis"],
  );
});

test("matchesLookupCasePattern() supports wildcards", () => {
  assertEquals(
    matchesLookupCasePattern(["solidstart", "deno", "postgres", "redis"])(
      ["solidstart", "deno", "*", "*"],
    ),
    true,
  );
  assertEquals(
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

  assertEquals(
    dirs.filter(isTestable),
    [
      join("/tmp", "hyd", "solidstart", "npm", "postgres", "redis"),
      join("/tmp", "hyd", "hono", "deno", "denokv", "denokv"),
    ],
  );
});
