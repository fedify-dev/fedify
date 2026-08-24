import { match, strictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test as nodeTest } from "node:test";
import { pathToFileURL } from "node:url";
import { test, type TestDefinition, type TestStepDefinition } from "./test.ts";

nodeTest("portable test definitions expose only shared options", () => {
  const definition = {
    name: "test",
    ignore: true,
    fn() {},
  } satisfies TestDefinition;
  const step = {
    name: "step",
    ignore: true,
    fn() {},
  } satisfies TestStepDefinition;

  strictEqual(definition.ignore, true);
  strictEqual(step.ignore, true);
});

nodeTest("the ESM build registers portable tests on Node.js", () => {
  if ("Deno" in globalThis || "Bun" in globalThis) return;
  const fixtureUrl = pathToFileURL(resolve("../dist/mod.js"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { test } from ${JSON.stringify(fixtureUrl.href)};\n` +
      `test("external ESM test", () => {});`,
    ],
    { encoding: "utf8", env },
  );
  match(output, /# Subtest: external ESM test/);
});

function checkRejectedOptions(): void {
  const fn = () => {};

  // @ts-expect-error: retry behavior is not portable across test runtimes.
  test("retry", { retry: 1 }, fn);
  // @ts-expect-error: repeat behavior is not portable across test runtimes.
  test("repeats", { repeats: 1 }, fn);
  // @ts-expect-error: focused tests are not portable across test runtimes.
  test("only", { only: true }, fn);

  const retryDefinition: TestDefinition = {
    name: "retry",
    // @ts-expect-error: retry behavior is not portable across test runtimes.
    retry: 1,
    fn,
  };
  const repeatedStep: TestStepDefinition = {
    name: "repeats",
    // @ts-expect-error: repeat behavior is not portable across test runtimes.
    repeats: 1,
    fn,
  };
  const focusedDefinition: TestDefinition = {
    name: "only",
    // @ts-expect-error: focused tests are not portable across test runtimes.
    only: true,
    fn,
  };
  void retryDefinition;
  void repeatedStep;
  void focusedDefinition;
}

void checkRejectedOptions;
