import assert from "node:assert/strict";
import test from "node:test";
import type { ScenarioType } from "../scenario/types.ts";
import { runnerFor } from "./registry.ts";

test("runnerFor - returns the inbox and webfinger runners", () => {
  assert.strictEqual(typeof runnerFor("inbox").run, "function");
  assert.strictEqual(typeof runnerFor("webfinger").run, "function");
});

test("runnerFor - throws for scenario types without a runner", () => {
  const unimplemented: ScenarioType[] = [
    "actor",
    "object",
    "fanout",
    "collection",
    "failure",
    "mixed",
  ];
  for (const type of unimplemented) {
    assert.throws(() => runnerFor(type), /not implemented/);
  }
});
