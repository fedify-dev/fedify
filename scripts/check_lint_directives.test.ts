import { deepStrictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkLintDirectives,
  findProblemsInText,
} from "./check_lint_directives.ts";

const knownRules = new Set([
  "typescript/no-explicit-any",
  "eslint/no-unused-vars",
]);

describe("findProblemsInText()", () => {
  it("rejects a bare disable directive", () => {
    deepStrictEqual(
      findProblemsInText("example.ts", "// oxlint-disable\n", knownRules),
      [{
        file: "example.ts",
        line: 1,
        message: "bare oxlint-disable must name at least one rule",
      }],
    );
  });

  it("rejects an unknown rule name", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "// oxlint-disable-next-line no-such-rule\n",
        knownRules,
      ),
      [{
        file: "example.ts",
        line: 1,
        message: "unknown Oxlint rule in directive: no-such-rule",
      }],
    );
  });

  it("accepts a named directive for a known rule", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "// oxlint-disable-next-line typescript/no-explicit-any\n",
        knownRules,
      ),
      [],
    );
  });

  it("accepts multiple comma-separated rules", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "// oxlint-disable typescript/no-explicit-any, eslint/no-unused-vars\n",
        knownRules,
      ),
      [],
    );
  });

  it("accepts a documented inline reason", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "// oxlint-disable-next-line eslint/no-unused-vars -- Public API.\n",
        knownRules,
      ),
      [],
    );
  });

  it("rejects a trailing bare disable comment", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "const value = 1; // oxlint-disable\n",
        knownRules,
      ),
      [{
        file: "example.ts",
        line: 1,
        message: "bare oxlint-disable must name at least one rule",
      }],
    );
  });

  it("rejects a trailing bare disable comment without a space", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "const value = 1;// oxlint-disable\n",
        knownRules,
      ),
      [{
        file: "example.ts",
        line: 1,
        message: "bare oxlint-disable must name at least one rule",
      }],
    );
  });

  it("rejects a directive adjacent to a string literal", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        'const value = "x"// oxlint-disable\n',
        knownRules,
      ),
      [{
        file: "example.ts",
        line: 1,
        message: "bare oxlint-disable must name at least one rule",
      }],
    );
  });

  it("ignores directive-like text inside string literals", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        'export const example = "// oxlint-disable";\n',
        knownRules,
      ),
      [],
    );
  });

  it("ignores directive-like text inside template literals", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "export const text = `x// oxlint-disable`;\n",
        knownRules,
      ),
      [],
    );
  });

  it("finds a directive after a template literal", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "export const text = `x`;\n// oxlint-disable\n",
        knownRules,
      ),
      [{
        file: "example.ts",
        line: 2,
        message: "bare oxlint-disable must name at least one rule",
      }],
    );
  });

  it("ignores directive-like text inside regex literals", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "export const pattern = /`[^`]*`/;\n",
        knownRules,
      ),
      [],
    );
  });

  it("finds a directive before a closing brace", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "export function f() {\n  // oxlint-disable\n}\n",
        knownRules,
      ),
      [{
        file: "example.ts",
        line: 2,
        message: "bare oxlint-disable must name at least one rule",
      }],
    );
  });

  it("rejects a block bare disable comment", () => {
    deepStrictEqual(
      findProblemsInText(
        "example.ts",
        "/* oxlint-disable */\nconst value = 1;\n",
        knownRules,
      ),
      [{
        file: "example.ts",
        line: 1,
        message: "bare oxlint-disable must name at least one rule",
      }],
    );
  });
});

describe("checkLintDirectives()", () => {
  it("skips tracked files deleted from the worktree", () => {
    const root = mkdtempSync(join(tmpdir(), "fedify-lint-directives-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      writeFileSync(
        join(root, ".oxlintrc.json"),
        JSON.stringify({ rules: { "typescript/no-explicit-any": "error" } }),
      );
      writeFileSync(join(root, "keep.ts"), "export const value = 1;\n");
      execFileSync("git", ["add", "keep.ts"], { cwd: root });
      rmSync(join(root, "keep.ts"));
      deepStrictEqual(
        checkLintDirectives(root, join(root, ".oxlintrc.json")),
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes untracked, non-ignored source files", () => {
    const root = mkdtempSync(join(tmpdir(), "fedify-lint-directives-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      writeFileSync(
        join(root, ".oxlintrc.json"),
        JSON.stringify({ rules: { "typescript/no-explicit-any": "error" } }),
      );
      writeFileSync(join(root, "new-file.ts"), "// oxlint-disable\n");
      deepStrictEqual(
        checkLintDirectives(root, join(root, ".oxlintrc.json")),
        [{
          file: "new-file.ts",
          line: 1,
          message: "bare oxlint-disable must name at least one rule",
        }],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
