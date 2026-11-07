import { deepStrictEqual, equal, match } from "node:assert/strict";
import { it } from "node:test";
import { checkFormatTransition } from "./check_format_transition.ts";
import type { commandOutput } from "./tooling_process.ts";

const generated = ["fmt", "--check", "packages/vocab/src/vocab.ts"];

function fixture(
  tree: readonly ("oxfmt" | "deno" | "invalid")[],
  generatedOkay = true,
) {
  const calls: { command: string; args: string[] }[] = [];
  const diagnostics: string[] = [];
  const run: typeof commandOutput = (command, args) => {
    calls.push({ command, args });
    const generatedCheck = command === "deno" &&
      args.join("\0") === generated.join("\0");
    // Model each formatter checking the complete selection. Their syntax and
    // configuration are exercised separately against the real Oxfmt binary.
    const formatter = command === "pnpm" ? "oxfmt" : "deno";
    const success = generatedCheck
      ? generatedOkay
      : tree.every((file) => file === formatter);
    return Promise.resolve({
      success,
      code: success ? 0 : 1,
      stdout: new TextEncoder().encode(`${formatter} output\n`),
      stderr: new TextEncoder().encode(success ? "" : "formatting failed\n"),
    });
  };
  return {
    calls,
    diagnostics,
    run,
    report: (text: string) => diagnostics.push(text),
  };
}

it("accepts a whole Oxfmt-only tree quietly and checks generated code", async () => {
  const f = fixture(["oxfmt", "oxfmt"]);
  equal(await checkFormatTransition(undefined, f), true);
  deepStrictEqual(f.calls, [
    {
      command: "pnpm",
      args: ["exec", "oxfmt", "-c", ".oxfmtrc.json", "--check", "."],
    },
    { command: "deno", args: generated },
  ]);
  deepStrictEqual(f.diagnostics, []);
});

it("accepts a whole Deno-only selection without splitting paths", async () => {
  const f = fixture(["deno", "deno"]);
  const paths = ["packages/space here", "packages/a&b"];
  equal(await checkFormatTransition(paths, f), true);
  deepStrictEqual(f.calls, [
    {
      command: "pnpm",
      args: ["exec", "oxfmt", "-c", ".oxfmtrc.json", "--check", ...paths],
    },
    { command: "deno", args: ["fmt", "--check", ...paths] },
    { command: "deno", args: generated },
  ]);
  deepStrictEqual(f.diagnostics, []);
});

for (const tree of [["oxfmt", "deno"], ["invalid", "invalid"]] as const) {
  it(`rejects a tree containing ${tree.join(" and ")}`, async () => {
    const f = fixture(tree);
    equal(await checkFormatTransition(undefined, f), false);
    equal(f.calls.length, 2);
    equal(f.diagnostics.length, 1);
    match(f.diagnostics[0], /pnpm exec oxfmt -c .oxfmtrc.json --check/);
    match(f.diagnostics[0], /deno fmt --check/);
    match(f.diagnostics[0], /formatting failed/);
  });
}

for (const formatter of ["oxfmt", "deno"] as const) {
  it(`rejects invalid generated code after ${formatter} passes`, async () => {
    const f = fixture([formatter], false);
    equal(await checkFormatTransition(["packages/other"], f), false);
    deepStrictEqual(f.calls.at(-1), { command: "deno", args: generated });
    equal(f.diagnostics.length, 1);
    match(f.diagnostics[0], /packages\/vocab\/src\/vocab.ts/);
  });
}

it("tries Deno after an Oxfmt launch failure", async () => {
  const f = fixture(["deno"]);
  const run: typeof commandOutput = async (command, args, options) => {
    if (command === "pnpm") throw new Error("Oxfmt unavailable");
    return await f.run(command, args, options);
  };
  equal(await checkFormatTransition(undefined, { ...f, run }), true);
  deepStrictEqual(f.diagnostics, []);
  deepStrictEqual(f.calls.at(-1), { command: "deno", args: generated });
});
