import { parse } from "@typescript-eslint/parser";
import { equal } from "node:assert/strict";
import { test } from "node:test";
import { indexHelperBindings } from "../lib/helper-bindings.ts";
import { isNode } from "../lib/pred.ts";
import type { FunctionLikeNode } from "../lib/reachability.ts";
import type { Node } from "../lib/types.ts";

function inspect(body: string) {
  const ast = parse(`function listener() { ${body} }`);
  const listener = ast.body[0] as unknown as FunctionLikeNode;
  const calls: Node[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (isNode(value)) {
      if (
        value.type === "CallExpression" &&
        value.callee.type === "Identifier" &&
        value.callee.name === "probe"
      )
        calls.push(value.callee);
      for (const [key, child] of Object.entries(value))
        if (key !== "parent") visit(child);
    }
  };
  visit(listener);
  return { index: indexHelperBindings(listener), reference: calls.at(-1)! };
}

for (const [body, stable] of [
  ["const probe = () => []; probe();", true],
  ["let probe = () => []; probe();", true],
  ["{ var probe = () => []; } probe();", true],
  ["function probe() { return []; } probe();", true],
  ["let probe; probe = () => []; probe();", false],
  ["let probe = () => []; probe = () => []; probe();", false],
  ["let probe = () => []; if (false) probe = () => []; probe();", false],
  [
    "let probe = () => []; function unused() { probe = () => []; } probe();",
    false,
  ],
  [
    "let probe = () => []; const unused = { get value() { probe = () => []; } }; probe();",
    false,
  ],
  ["const probe = () => []; probe.extra = () => {}; probe();", true],
  [
    "const probe = () => []; for ([probe.extra = () => {}] of [[]]) {} probe();",
    true,
  ],
  [
    "const probe = () => []; ({ value: probe.extra = () => {} } = {}); probe();",
    true,
  ],
  ["const probe = () => []; { const probe = external; probe(); }", false],
  ["const probe = () => []; { let probe; probe = external; } probe();", true],
  [
    "const probe = () => []; function unused(probe) { probe = external; } probe();",
    true,
  ],
  [
    "const probe = () => []; class C { static { var probe; probe = external; } } probe();",
    true,
  ],
  [
    "const probe = () => []; try {} catch (probe) { probe = external; } probe();",
    true,
  ],
  ["const { probe } = { probe: () => [] }; probe();", false],
  ["const probe = external; probe();", false],
  [
    "switch (kind) { case 0: function probe() { return []; } case 1: probe(); }",
    true,
  ],
  ["switch (probe()) { case 0: function probe() { return []; } }", false],
  ["class C { static { var probe = () => []; } } probe();", false],
  [
    "const probe = () => []; function invoke(value = probe()) { const probe = external; }",
    true,
  ],
] as const) {
  test(`helper binding stability: ${body}`, () => {
    const { index, reference } = inspect(body);
    equal(index.resolve(reference) != null, stable);
  });
}

test("completion alternatives do not certify an array helper", () => {
  const { index, reference } = inspect(`
    let probe = async () => [];
    probe = () => delivery();
    probe();
  `);
  equal(index.resolve(reference), null);
  equal(index.completionCandidates(reference).length, 2);
});

test("unknown writes also disqualify completion alternatives", () => {
  const { index, reference } = inspect(`
    let probe = () => delivery();
    const unused = () => { probe = external; };
    probe();
  `);
  equal(index.completionCandidates(reference).length, 0);
});
