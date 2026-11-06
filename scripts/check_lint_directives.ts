/**
 * Checks that Oxlint disable/enable directives name explicit rules.
 *
 * Deno's `ban-untagged-ignore` rule rejected bare `deno-lint-ignore`
 * comments.  Oxlint permits a bare `oxlint-disable`, which would silently
 * suppress every enabled rule.  This script restores that guard and also
 * verifies that named rules exist in the root configuration.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isMain } from "./tooling_main.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A single invalid directive. */
export interface DirectiveProblem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** Rules enabled by the root configuration, including overrides. */
export function collectKnownRules(config: unknown): Set<string> {
  const rules = new Set<string>();
  const addRules = (value: unknown) => {
    if (value == null || typeof value !== "object") return;
    for (const name of Object.keys(value)) rules.add(name);
  };
  if (config != null && typeof config === "object") {
    const record = config as Record<string, unknown>;
    addRules(record.rules);
    if (Array.isArray(record.overrides)) {
      for (const override of record.overrides) {
        if (override != null && typeof override === "object") {
          addRules((override as Record<string, unknown>).rules);
        }
      }
    }
  }
  return rules;
}

/** Returns the 1-based line number of a character offset. */
function addCommentRanges(
  ranges: readonly ts.CommentRange[] | undefined,
  comments: Map<string, ts.CommentRange>,
): void {
  if (ranges == null) return;
  for (const range of ranges) {
    if (
      range.kind !== ts.SyntaxKind.SingleLineCommentTrivia &&
      range.kind !== ts.SyntaxKind.MultiLineCommentTrivia
    ) continue;
    comments.set(`${range.pos}:${range.end}`, range);
  }
}

/** Finds directives in one file's text. */
export function findProblemsInText(
  file: string,
  text: string,
  knownRules: ReadonlySet<string>,
): DirectiveProblem[] {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
  );
  const comments = new Map<string, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    addCommentRanges(
      ts.getLeadingCommentRanges(text, node.getFullStart()),
      comments,
    );
    addCommentRanges(
      ts.getTrailingCommentRanges(text, node.getEnd()),
      comments,
    );
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  addCommentRanges(
    ts.getLeadingCommentRanges(text, sourceFile.endOfFileToken.getFullStart()),
    comments,
  );
  const problems: DirectiveProblem[] = [];
  for (const range of comments.values()) {
    const comment = text.slice(range.pos, range.end);
    const match = comment.match(
      /^\/\/\s*(oxlint|eslint)-(disable(?:-next-line|-line)?|enable)\b([^\n]*)$/,
    ) ?? comment.match(
      /^\/\*\s*(oxlint|eslint)-(disable(?:-next-line|-line)?|enable)\b([\s\S]*?)\*\/$/,
    );
    if (match == null) continue;
    const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;
    const directive = `${match[1]}-${match[2]}`;
    const remainder = match[3];
    const reasonIndex = remainder.indexOf(" -- ");
    const rulesText = reasonIndex === -1
      ? remainder
      : remainder.slice(0, reasonIndex);
    const names = rulesText.trim().split(/[\s,]+/).filter((name) =>
      name.length > 0
    );
    if (names.length === 0) {
      problems.push({
        file,
        line,
        message: `bare ${directive} must name at least one rule`,
      });
      continue;
    }
    for (const name of names) {
      const normalized = name.startsWith("@typescript-eslint/")
        ? `typescript/${name.slice("@typescript-eslint/".length)}`
        : name;
      if (!knownRules.has(normalized)) {
        problems.push({
          file,
          line,
          message: `unknown Oxlint rule in directive: ${name}`,
        });
      }
    }
  }
  return problems.sort((a, b) => a.line - b.line);
}

/** Lists JS/TS files under the given paths, including untracked files. */
function listFiles(root: string, paths: readonly string[]): string[] {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  const output = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...(paths.length === 0 ? ["."] : paths),
    ],
    { cwd: root, encoding: "utf8", env },
  );
  return output.split("\0").filter((path) =>
    path.length > 0 &&
    /\.(?:[cm]?[jt]sx?)$/.test(path) &&
    !path.endsWith(".snap") &&
    !path.includes("/__snapshots__/") &&
    !path.startsWith("scripts/check_lint_directives") &&
    path !== "examples/cloudflare-workers/worker-configuration.d.ts"
  );
}

/** Scans the repository, or the given paths, for invalid directives. */
export function checkLintDirectives(
  root: string,
  configPath: string,
  paths: readonly string[] = [],
): DirectiveProblem[] {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const knownRules = collectKnownRules(config);
  const problems: DirectiveProblem[] = [];
  for (const file of listFiles(root, paths)) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    problems.push(...findProblemsInText(file, text, knownRules));
  }
  return problems;
}

if (isMain(import.meta.url)) {
  const paths = process.argv.slice(2);
  const problems = checkLintDirectives(
    projectRoot,
    join(projectRoot, ".oxlintrc.json"),
    paths,
  );
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.line}: ${problem.message}`);
  }
  if (problems.length > 0) process.exitCode = 1;
}
