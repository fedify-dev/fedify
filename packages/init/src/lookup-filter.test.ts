import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { test } from "node:test";
import {
  filterLookupDirs,
  getBannedLookupFrameworks,
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
    matchesLookupCasePattern(
      ["solidstart", "deno", "*", "*"],
      ["solidstart", "deno", "postgres", "redis"],
    ),
    true,
  );
  assertEquals(
    matchesLookupCasePattern(
      ["solidstart", "deno", "*", "*"],
      ["solidstart", "npm", "postgres", "redis"],
    ),
    false,
  );
});

test("filterLookupDirs() excludes banned lookup cases only", () => {
  const dirs = [
    join("/tmp", "cases", "next", "pnpm", "postgres", "redis"),
    join("/tmp", "cases", "solidstart", "deno", "postgres", "redis"),
    join("/tmp", "cases", "solidstart", "npm", "postgres", "redis"),
    join("/tmp", "cases", "hono", "deno", "denokv", "denokv"),
  ];

  assertEquals(
    filterLookupDirs(dirs),
    [
      join("/tmp", "cases", "solidstart", "npm", "postgres", "redis"),
      join("/tmp", "cases", "hono", "deno", "denokv", "denokv"),
    ],
  );
});

test("getBannedLookupFrameworks() returns framework-wide bans", () => {
  assertEquals(getBannedLookupFrameworks(), ["next"]);
});
