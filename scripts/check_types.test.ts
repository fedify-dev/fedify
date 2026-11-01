import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkProject,
  classifyDeclarationDiagnostics,
  type CoverageInput,
  discoverProjects,
  findCoverageProblems,
  findDenoAccesses,
  globToRegExp,
  isDeclarationDiagnostic,
  isOwnDiagnostic,
  type KnownDeclarationProblem,
  listDeclarationEntries,
  parseCompilerOutput,
  writeDeclarationConsumers,
} from "./check_types.ts";
import { DENO_CHECK, type Ownership } from "./check_types_ownership.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("globToRegExp()", () => {
  it("matches within and across path segments", () => {
    ok(
      globToRegExp("packages/*/src/**/*.bench.ts").test(
        "packages/vocab/src/vocab.bench.ts",
      ),
    );
    ok(
      globToRegExp("packages/*/src/**/*.bench.ts").test(
        "packages/uri-template/src/router/router.bench.ts",
      ),
    );
    ok(!globToRegExp("packages/*/src/*.ts").test("packages/a/src/b/c.ts"));
    ok(globToRegExp("packages/denokv/**").test("packages/denokv/src/mod.ts"));
    ok(!globToRegExp("scripts/install.ts").test("scripts/installXts"));
  });
});

describe("parseCompilerOutput()", () => {
  it("separates diagnostics, their continuation lines, and listed files", () => {
    const output = [
      "packages/a/src/mod.ts(1,7): error TS2322: Type 'string' is not",
      "  assignable to type 'number'.",
      "error TS5083: Cannot read file 'missing.json'.",
      join(root, "packages", "a", "src", "mod.ts"),
      "something unexpected",
    ].join("\n");
    deepStrictEqual(parseCompilerOutput(output, root), {
      diagnostics: [
        {
          file: "packages/a/src/mod.ts",
          text: "packages/a/src/mod.ts(1,7): error TS2322: Type 'string' is " +
            "not\n  assignable to type 'number'.",
        },
        { text: "error TS5083: Cannot read file 'missing.json'." },
        { text: "something unexpected" },
      ],
      files: ["packages/a/src/mod.ts"],
    });
  });
});

describe("isOwnDiagnostic()", () => {
  it("ignores third-party and built declarations only", () => {
    ok(isOwnDiagnostic({ file: "packages/a/src/mod.ts", text: "" }));
    ok(isOwnDiagnostic({ file: "packages/a/src/types.d.ts", text: "" }));
    ok(isOwnDiagnostic({ text: "error TS5083" }));
    ok(!isOwnDiagnostic({ file: "node_modules/x/index.d.ts", text: "" }));
    ok(!isOwnDiagnostic({ file: "packages/a/dist/mod.d.ts", text: "" }));
  });
});

describe("discoverProjects()", () => {
  it("finds check configurations and their variants only", () => {
    deepStrictEqual(
      discoverProjects(
        ["packages/a", "packages/b"],
        (dir) =>
          dir === "packages/a"
            ? [
              "tsconfig.json",
              "tsconfig.check.workers.json",
              "tsconfig.check.json",
              "tsconfig.check.json.bak",
            ]
            : [],
      ),
      [
        "packages/a/tsconfig.check.json",
        "packages/a/tsconfig.check.workers.json",
      ],
    );
  });
});

describe("findDenoAccesses()", () => {
  const accesses = (source: string) =>
    findDenoAccesses("rule.ts", source).map((access) =>
      access.replace(/^rule\.ts:\d+:\d+: /, "")
    );

  for (
    const source of [
      'Deno.env.get("HOME");',
      'globalThis.Deno.env.get("HOME");',
      'globalThis["Deno"].env.get("HOME");',
      "const { Deno: runtime } = globalThis;",
      'const { ["Deno"]: runtime } = globalThis;',
      'const { "Deno": runtime } = globalThis;',
      "const isDeno = typeof Deno !== 'undefined';",
      "export class Missing extends Deno.errors.NotFound {}",
    ]
  ) {
    it(`rejects ${source}`, () => {
      equal(accesses(source).length, 1);
    });
  }

  for (
    const source of [
      "export type Rule = Deno.lint.Rule;",
      "const rule: Deno.lint.Rule = { create() { return {}; } };",
      "type Run = typeof Deno.lint.runPlugin;",
      "interface Env { Deno: unknown }",
      "interface Plugin extends Deno.lint.Plugin {}",
      "abstract class Rule implements Deno.lint.Rule { abstract create: never }",
      'const isDeno = "Deno" in globalThis;',
      'console.log("Deno");',
    ]
  ) {
    it(`allows ${source}`, () => {
      deepStrictEqual(accesses(source), []);
    });
  }
});

describe("findCoverageProblems()", () => {
  const input = (overrides: Partial<CoverageInput> = {}): CoverageInput => ({
    requiredFiles: [
      "packages/a/src/mod.ts",
      "packages/deno-only/mod.ts",
      "scripts/tool.ts",
    ],
    projects: new Map([
      ["packages/a/tsconfig.check.json", ["packages/a/src/mod.ts"]],
      ["tsconfig.check.json", ["scripts/tool.ts"]],
    ]),
    denoTypedProjects: [],
    ownership: [{
      path: "packages/deno-only/**",
      owner: DENO_CHECK,
      reason: "Deno-only.",
    }],
    packageDirs: ["packages/a"],
    isDenoCheckInput: (file) => file.startsWith("packages/"),
    exists: () => false,
    ...overrides,
  });

  it("accepts files covered by projects or ownership", () => {
    deepStrictEqual(findCoverageProblems(input()), []);
  });

  it("reports a file outside every project", () => {
    const problems = findCoverageProblems(input({
      requiredFiles: [...input().requiredFiles, "scripts/new.mts"],
    }));
    equal(problems.length, 1);
    match(problems[0], /^scripts\/new\.mts is not covered/);
  });

  it("does not count Deno workspace membership as coverage", () => {
    // packages/a stays a Deno workspace member, but its project is gone.
    const problems = findCoverageProblems(input({
      projects: new Map([["tsconfig.check.json", ["scripts/tool.ts"]]]),
    }));
    deepStrictEqual(problems.map((problem) => problem.split(" ")[0]), [
      "packages/a/src/mod.ts",
      "packages/a",
    ]);
  });

  it("reports ownership by a Deno check that does not check the file", () => {
    const problems = findCoverageProblems(input({
      isDenoCheckInput: () => false,
    }));
    equal(problems.length, 1);
    match(problems[0], /is assigned to check:types:deno, which does not/);
  });

  it("reports stale ownership entries", () => {
    const stale: Ownership = {
      path: "packages/gone/**",
      owner: DENO_CHECK,
      reason: "Removed.",
    };
    const problems = findCoverageProblems(input({
      ownership: [...input().ownership, stale],
    }));
    equal(problems.length, 1);
    match(problems[0], /packages\/gone\/\*\* matches no file/);
  });

  it("reports Deno-typed projects without a runtime guard", () => {
    const problems = findCoverageProblems(input({
      denoTypedProjects: ["packages/a/tsconfig.check.json"],
    }));
    equal(problems.length, 1);
    match(problems[0], /loads Deno's ambient types but is not listed/);
  });
});

describe("environment presets", () => {
  // Fixture projects live under the repository's node_modules so that type
  // packages resolve, where formatters, linters, and the coverage check do
  // not look.  Their diagnostics are read unfiltered for the same reason.
  async function check(preset: string, source: string): Promise<string[]> {
    const cache = join(root, "node_modules", ".cache");
    await mkdir(cache, { recursive: true });
    const dir = await mkdtemp(join(cache, "fedify-check-types-test-"));
    try {
      await writeFile(
        join(dir, "tsconfig.check.json"),
        JSON.stringify({
          extends: relative(dir, join(root, preset)).split(sep).join("/"),
          include: ["*.ts"],
        }),
      );
      await writeFile(join(dir, "mod.ts"), `${source}\nexport {};\n`);
      const fixture = relative(root, dir).split(sep).join("/");
      const result = await checkProject(`${fixture}/tsconfig.check.json`);
      return result.diagnostics
        .filter((diagnostic) =>
          diagnostic.file == null || diagnostic.file.startsWith(`${fixture}/`)
        )
        .map((diagnostic) => diagnostic.text);
    } finally {
      await rm(dir, { recursive: true });
    }
  }

  it("accepts Node.js and web APIs in the Node.js preset", async () => {
    deepStrictEqual(
      await check(
        "tsconfig.node.json",
        'import process from "node:process";\n' +
          "const key: CryptoKey | undefined = undefined;\n" +
          "await fetch(new URL(process.cwd(), 'file:'));\n" +
          "void key;",
      ),
      [],
    );
  });

  it("detects a type error", async () => {
    const errors = await check("tsconfig.node.json", 'const n: number = "";');
    equal(errors.length, 1);
    match(errors[0], /error TS2322/);
  });

  it("rejects Deno globals in the Node.js preset", async () => {
    const errors = await check("tsconfig.node.json", 'Deno.env.get("HOME");');
    equal(errors.length, 1);
    match(errors[0], /Cannot find name 'Deno'/);
  });

  it("rejects browser document globals in the Node.js preset", async () => {
    const errors = await check("tsconfig.node.json", "document.title;");
    equal(errors.length, 1);
    match(errors[0], /Cannot find name 'document'/);
  });

  it("rejects Node.js globals in the Workers preset", async () => {
    const errors = await check("tsconfig.workers.json", "process.exit(1);");
    equal(errors.length, 1);
    match(errors[0], /Cannot find name 'process'/);
  });

  it("accepts Workers globals in the Workers preset", async () => {
    deepStrictEqual(
      await check(
        "tsconfig.workers.json",
        "const batch: MessageBatch | undefined = undefined;\nvoid batch;",
      ),
      [],
    );
  });
});

describe("listDeclarationEntries()", () => {
  it("lists type-bearing exports and the CommonJS ones", () => {
    deepStrictEqual(
      listDeclarationEntries("a", {
        name: "@fedify/a",
        exports: {
          ".": { import: "./dist/mod.js", require: "./dist/mod.cjs" },
          "./esm": "./dist/esm.js",
          "./nested": { types: { require: "./dist/n.d.cts" } },
          "./fixtures/*": "./dist/fixtures/*",
          "./package.json": "./package.json",
        },
      }),
      {
        dir: "a",
        esm: ["@fedify/a", "@fedify/a/esm", "@fedify/a/nested"],
        cjs: ["@fedify/a", "@fedify/a/nested"],
      },
    );
  });

  it("skips private packages and executables", () => {
    equal(
      listDeclarationEntries("a", { name: "a", private: true, exports: {} }),
      undefined,
    );
    equal(
      listDeclarationEntries("cli", { name: "cli", exports: "./dist/mod.js" }),
      undefined,
    );
  });
});

describe("classifyDeclarationDiagnostics()", () => {
  const known: KnownDeclarationProblem = {
    file: "packages/a/dist/mod.d.*ts",
    code: "TS7016",
    message: /module 'untyped'/,
    reason: "Known.",
  };

  it("separates known problems from new errors", () => {
    const result = classifyDeclarationDiagnostics([
      {
        file: "packages/a/dist/mod.d.cts",
        text: "packages/a/dist/mod.d.cts(1,1): error TS7016: Could not " +
          "find a declaration file for module 'untyped'.",
      },
      {
        file: "packages/a/dist/mod.d.ts",
        text: "packages/a/dist/mod.d.ts(2,1): error TS2304: Missing.",
      },
    ], [known]);
    deepStrictEqual(result.errors.map((error) => error.file), [
      "packages/a/dist/mod.d.ts",
    ]);
    deepStrictEqual([...result.matched], [known]);
  });

  it("does not let a known problem hide another one in the same file", () => {
    const result = classifyDeclarationDiagnostics([{
      file: "packages/a/dist/mod.d.ts",
      text: "packages/a/dist/mod.d.ts(3,1): error TS7016: Could not find a " +
        "declaration file for module 'other'.",
    }], [known]);
    equal(result.errors.length, 1);
    deepStrictEqual([...result.matched], []);
  });

  it("counts only first-party declarations and consumers", () => {
    ok(isDeclarationDiagnostic(
      { file: "packages/a/dist/mod.d.ts", text: "" },
      ["packages/a"],
    ));
    ok(
      !isDeclarationDiagnostic(
        { file: "node_modules/.pnpm/x/index.d.ts", text: "" },
        ["packages/a"],
      ),
    );
  });
});

describe("writeDeclarationConsumers()", () => {
  it("detects a broken public declaration", async () => {
    const cache = join(root, "node_modules", ".cache");
    await mkdir(cache, { recursive: true });
    const dir = await mkdtemp(join(cache, "fedify-check-types-test-"));
    const fixture = relative(root, dir).split(sep).join("/");
    try {
      const pkg = join(dir, "packages", "broken");
      await mkdir(join(pkg, "dist"), { recursive: true });
      await writeFile(
        join(pkg, "package.json"),
        JSON.stringify({
          name: "@fedify/broken",
          type: "module",
          exports: { ".": "./dist/mod.js" },
        }),
      );
      await writeFile(
        join(pkg, "dist", "mod.js"),
        "export function api() {}\n",
      );
      await writeFile(
        join(pkg, "dist", "mod.d.ts"),
        "export declare function api(): MissingPublicType;\n",
      );
      const [project] = writeDeclarationConsumers(
        [{ dir: "broken", esm: ["@fedify/broken"], cjs: [] }],
        `${fixture}/consumers`,
        `${fixture}/packages`,
      );
      const result = await checkProject(project);
      const errors = result.diagnostics.filter((diagnostic) =>
        isDeclarationDiagnostic(diagnostic, [`${fixture}/packages/broken`])
      );
      equal(errors.length, 1);
      match(errors[0].text, /Cannot find name 'MissingPublicType'/);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
