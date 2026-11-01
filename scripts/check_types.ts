/**
 * Type-checks the repository with TypeScript on Node.js, without Deno.
 *
 * Runs the TypeScript 7 compiler over every type-checking project:
 * *tsconfig.check.json* and *tsconfig.check.\*.json* in each package under
 * *packages/*, plus the root and other projects listed in `EXTRA_PROJECTS`.
 * Workspace packages resolve through their built declarations, so packages
 * must be built first.  Pass package names (without the `@fedify/` prefix) to
 * check only those packages.
 *
 * Besides compiler diagnostics, it verifies that:
 *
 *  -  every TypeScript file in the covered paths belongs to a project, or to
 *     another check through *scripts/check\_types\_ownership.ts*;
 *  -  only the projects allowed there load Deno's ambient types, and their
 *     files access the `Deno` global at run time only where allowed.
 *
 * Deno-specific code keeps its own check, `mise run check:types:deno`.
 * @module
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import {
  DENO_CHECK,
  DENO_EXTRA_ENTRY_POINTS,
  DENO_TYPED_PROJECTS,
  OWNERSHIP,
  type Ownership,
} from "./check_types_ownership.ts";
import { isMain } from "./tooling_main.ts";
import { commandOutput } from "./tooling_process.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The TypeScript 7 compiler; the `typescript` package is TypeScript 6. */
const tsc = join(root, "node_modules", "typescript7", "bin", "tsc");

/** Projects outside *packages/* that the full check also runs. */
export const EXTRA_PROJECTS: readonly string[] = [
  "tsconfig.check.json",
  "examples/test-examples/tsconfig.check.json",
];

/**
 * Paths whose TypeScript files must be covered.  Other examples own their
 * framework-specific checks, and the documentation is validated by its build.
 */
export const COVERED_PATHS: readonly string[] = [
  "packages/**",
  "scripts/**",
  "examples/monitoring/validate.ts",
  "examples/test-examples/**",
  "docs/.vitepress/contributors.mts",
  "docs/.vitepress/contributors.test.mts",
];

const typeScriptExtension = /\.(?:[cm]?ts|tsx)$/;

/** Converts a repository path to the forward-slash form used here. */
function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** Converts a glob (`*` within a segment, `**` across segments) to a regex. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      pattern += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else {
      pattern += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

/** A compiler diagnostic, or a line of compiler output that is not one. */
export interface Diagnostic {
  /** Repository-relative file, or `undefined` for global diagnostics. */
  readonly file?: string;
  readonly text: string;
}

/** The parsed result of one compiler run. */
export interface CompilerOutput {
  readonly diagnostics: readonly Diagnostic[];
  /** Repository-relative files in the program, from `--listFiles`. */
  readonly files: readonly string[];
}

const diagnosticLine = /^(.+?)\(\d+,\d+\): (?:error|warning) TS\d+:/;
const globalDiagnosticLine = /^(?:error|warning) TS\d+:/;

/**
 * Parses `tsc --pretty false --listFiles` output.  Continuation lines are
 * attached to the diagnostic before them.
 */
export function parseCompilerOutput(
  output: string,
  projectDir: string,
): CompilerOutput {
  const diagnostics: Diagnostic[] = [];
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const match = diagnosticLine.exec(line);
    if (match != null) {
      diagnostics.push({
        file: toPosix(relative(root, resolve(projectDir, match[1]))),
        text: line,
      });
    } else if (globalDiagnosticLine.test(line)) {
      diagnostics.push({ text: line });
    } else if (/^\s/.test(line) && diagnostics.length > 0) {
      const last = diagnostics.pop()!;
      diagnostics.push({ ...last, text: `${last.text}\n${line}` });
    } else if (/^(?:[A-Za-z]:)?[\\/]/.test(line)) {
      files.push(toPosix(relative(root, line)));
    } else {
      // Unrecognized output must not be silently treated as success.
      diagnostics.push({ text: line });
    }
  }
  return { diagnostics, files };
}

/**
 * Whether a diagnostic belongs to this check.  Diagnostics in third-party
 * declarations and in built declarations under *dist/* are not: the former
 * are outside the repository's control, as with `skipLibCheck`, and the
 * latter are checked as public declarations.  Compiling with `skipLibCheck`
 * disabled and filtering here still checks first-party *.d.ts* files.
 */
export function isOwnDiagnostic(diagnostic: Diagnostic): boolean {
  if (diagnostic.file == null) return true;
  const segments = diagnostic.file.split("/");
  return !segments.includes("node_modules") && !segments.includes("dist") &&
    !diagnostic.file.startsWith("../");
}

/** The result of checking one project. */
export interface ProjectResult extends CompilerOutput {
  readonly project: string;
  readonly code: number;
  /** Diagnostics that fail the check. */
  readonly errors: readonly Diagnostic[];
}

/** Type-checks a project and lists the files in its program. */
export async function checkProject(project: string): Promise<ProjectResult> {
  const result = await commandOutput(process.execPath, [
    tsc,
    "--project",
    join(root, project),
    "--noEmit",
    "--pretty",
    "false",
    "--skipLibCheck",
    "false",
    "--listFiles",
  ], { cwd: root });
  const output = new TextDecoder().decode(result.stdout) +
    new TextDecoder().decode(result.stderr);
  const parsed = parseCompilerOutput(output, root);
  const errors = parsed.diagnostics.filter(isOwnDiagnostic);
  // Exit codes 1 and 2 report diagnostics; anything else is a crash.
  if (![0, 1, 2].includes(result.code) && errors.length < 1) {
    errors.push({ text: `tsc exited with code ${result.code}.\n${output}` });
  }
  return { ...parsed, project, code: result.code, errors };
}

/** Reads the package directories listed in *pnpm-workspace.yaml*. */
export function readWorkspacePackages(): string[] {
  const workspace = parseYaml(
    readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
  ) as { packages: string[] };
  return workspace.packages.filter((path) => path.startsWith("packages/"));
}

/** Lists the type-checking projects of the given package directories. */
export function discoverProjects(
  packageDirs: readonly string[],
  listFiles: (dir: string) => readonly string[],
): string[] {
  return packageDirs.flatMap((dir) =>
    listFiles(dir)
      .filter((name) => /^tsconfig\.check(?:\.[\w-]+)?\.json$/.test(name))
      .sort()
      .map((name) => `${dir}/${name}`)
  );
}

/** Lists existing tracked and non-ignored untracked TypeScript files. */
export async function listRepositoryFiles(): Promise<string[]> {
  const result = await commandOutput(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root },
  );
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  const files = new TextDecoder().decode(result.stdout).split("\0");
  // The index still lists files deleted or moved without staging.
  return [...new Set(files)]
    .filter((file) =>
      typeScriptExtension.test(file) && existsSync(join(root, file))
    )
    .sort();
}

/** Inputs for {@link findCoverageProblems}. */
export interface CoverageInput {
  /** Repository TypeScript files that must be covered. */
  readonly requiredFiles: readonly string[];
  /** Each checked project and the files in its program. */
  readonly projects: ReadonlyMap<string, readonly string[]>;
  /** Projects that load Deno's ambient types. */
  readonly denoTypedProjects: readonly string[];
  readonly ownership: readonly Ownership[];
  /** Package directories that must have a project. */
  readonly packageDirs: readonly string[];
  /** Whether a repository file is an input of `check:types:deno`. */
  readonly isDenoCheckInput: (file: string) => boolean;
  /** Whether a repository path exists. */
  readonly exists: (glob: string) => boolean;
}

/**
 * Finds files that no check covers, stale ownership entries, packages
 * without a project, and Deno-typed projects that are not allowed.
 */
export function findCoverageProblems(input: CoverageInput): string[] {
  const problems: string[] = [];
  const owners = new Map<string, string[]>();
  for (const [project, files] of input.projects) {
    for (const file of files) {
      owners.set(file, [...owners.get(file) ?? [], project]);
    }
  }
  for (const project of input.denoTypedProjects) {
    if (!(project in DENO_TYPED_PROJECTS)) {
      problems.push(
        `${project} loads Deno's ambient types but is not listed in ` +
          "DENO_TYPED_PROJECTS in scripts/check_types_ownership.ts.",
      );
    }
  }
  const usedOwnership = new Set<Ownership>();
  for (const file of input.requiredFiles) {
    const ownership = input.ownership.find((entry) =>
      globToRegExp(entry.path).test(file)
    );
    if (ownership != null) {
      usedOwnership.add(ownership);
      if (ownership.owner === DENO_CHECK && !input.isDenoCheckInput(file)) {
        problems.push(
          `${file} is assigned to ${DENO_CHECK}, which does not check it.`,
        );
      }
      continue;
    }
    if (!owners.has(file)) {
      problems.push(
        `${file} is not covered by any type-checking project.  Include it ` +
          "in a tsconfig.check.json, or assign it to another check in " +
          "scripts/check_types_ownership.ts.",
      );
    }
  }
  for (const entry of input.ownership) {
    if (!usedOwnership.has(entry) && !input.exists(entry.path)) {
      problems.push(
        `The ownership entry for ${entry.path} matches no file; remove it.`,
      );
    }
  }
  const projectDirs = new Set(
    [...input.projects.keys()].map((project) => dirname(project)),
  );
  for (const dir of input.packageDirs) {
    if (!projectDirs.has(dir)) {
      problems.push(`${dir} has no tsconfig.check.json.`);
    }
  }
  return problems;
}

/** Whether a node is part of a type, not of a run-time expression. */
function isInTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current != null; current = current.parent) {
    // A class's extends clause is evaluated at run time even though its
    // syntax node is also used for type-only heritage, such as an
    // interface's extends clause or a class's implements clause.
    if (
      ts.isExpressionWithTypeArguments(current) &&
      ts.isHeritageClause(current.parent) &&
      current.parent.token === ts.SyntaxKind.ExtendsKeyword &&
      ts.isClassLike(current.parent.parent)
    ) {
      return false;
    }
    if (
      ts.isTypeNode(current) || ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current)
    ) {
      return true;
    }
    if (
      ts.isStatement(current) || ts.isExpression(current) &&
        !ts.isIdentifier(current) && !ts.isPropertyAccessExpression(current)
    ) {
      return false;
    }
  }
  return false;
}

function isDenoString(node: ts.Node | undefined): boolean {
  return node != null &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === "Deno";
}

/**
 * Finds run-time accesses to the `Deno` global: the identifier or a property
 * named `Deno` outside types, element access with a `"Deno"` key, and
 * `"Deno"` keys in destructuring patterns.  Type references such as
 * `Deno.lint.Rule` and the `"Deno" in globalThis` check are allowed.  This
 * guards against mistakes, not deliberate obfuscation such as computed keys.
 */
export function findDenoAccesses(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const accesses: string[] = [];
  const report = (node: ts.Node) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    accesses.push(
      `${fileName}:${line + 1}:${character + 1}: ${node.getText(sourceFile)}`,
    );
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) && node.text === "Deno" && !isInTypePosition(node)
    ) {
      report(node.parent);
    } else if (
      ts.isElementAccessExpression(node) &&
      isDenoString(node.argumentExpression)
    ) {
      report(node);
    } else if (
      ts.isComputedPropertyName(node) && isDenoString(node.expression) &&
      !isInTypePosition(node)
    ) {
      report(node.parent);
    } else if (
      ts.isBindingElement(node) && isDenoString(node.propertyName)
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return accesses;
}

/** Reads a project's `types` option, following `extends`. */
export function readProjectTypes(project: string): readonly string[] {
  const path = join(root, project);
  const config = ts.readConfigFile(path, ts.sys.readFile);
  if (config.error != null) {
    throw new Error(ts.flattenDiagnosticMessageText(
      config.error.messageText,
      "\n",
    ));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(path),
    undefined,
    path,
  );
  return parsed.options.types ?? [];
}

/** Checks files of Deno-typed projects for run-time `Deno` accesses. */
function guardDenoAccesses(results: readonly ProjectResult[]): string[] {
  const problems: string[] = [];
  for (const result of results) {
    const allowed = DENO_TYPED_PROJECTS[result.project];
    if (allowed == null) continue;
    for (const file of result.files) {
      if (!file.startsWith(`${dirname(result.project)}/`)) continue;
      if (allowed.includes(file)) continue;
      const source = readFileSync(join(root, file), "utf8");
      for (const access of findDenoAccesses(file, source)) {
        problems.push(
          `${access}: only the files listed for ${result.project} in ` +
            "DENO_TYPED_PROJECTS may access the Deno global at run time.",
        );
      }
    }
  }
  return problems;
}

/** Whether `deno check` checks a file, per *deno.json* and its members. */
function createDenoCheckInputTest(): (file: string) => boolean {
  const readJson = (path: string) =>
    JSON.parse(readFileSync(join(root, path), "utf8"));
  const rootConfig = readJson("deno.json") as {
    workspace: string[];
    exclude?: string[];
  };
  const members = rootConfig.workspace.map((member) => {
    const dir = member.replace(/^\.\//, "").replace(/\/$/, "");
    const config = readJson(`${dir}/deno.json`) as { exclude?: string[] };
    return { dir, exclude: config.exclude ?? [] };
  });
  const excluded = (path: string, patterns: readonly string[]) =>
    patterns.some((pattern) => {
      const normalized = pattern.replace(/^\.\//, "").replace(/\/$/, "");
      if (normalized.startsWith("!")) return false;
      return path === normalized || path.startsWith(`${normalized}/`) ||
        globToRegExp(normalized).test(path);
    });
  return (file) => {
    if (DENO_EXTRA_ENTRY_POINTS.includes(file)) return true;
    if (excluded(file, rootConfig.exclude ?? [])) return false;
    const member = members.find(({ dir }) => file.startsWith(`${dir}/`));
    return member != null &&
      !excluded(file.slice(member.dir.length + 1), member.exclude);
  };
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function main(args: readonly string[]): Promise<number> {
  const workspacePackages = readWorkspacePackages();
  const selected = args.length > 0;
  const packageDirs = selected
    ? args.map((name) => `packages/${name.replace(/^@fedify\//, "")}`)
    : workspacePackages;
  for (const dir of packageDirs) {
    if (!workspacePackages.includes(dir)) {
      console.error(`Error: ${dir} is not a workspace package.`);
      return 1;
    }
  }
  const projects = [
    ...(selected ? [] : EXTRA_PROJECTS),
    ...discoverProjects(packageDirs, (dir) => readdirSync(join(root, dir))),
  ];
  // Each compiler process is itself parallel, so a few at a time suffice.
  const concurrency = Math.max(1, Math.min(4, availableParallelism() >> 2));
  const results = await mapConcurrent(
    projects,
    concurrency,
    async (project) => {
      const result = await checkProject(project);
      const status = result.errors.length > 0 ? "FAIL" : "ok";
      console.log(`${status} ${project}`);
      return result;
    },
  );
  let failed = false;
  for (const result of results) {
    if (result.errors.length < 1) continue;
    failed = true;
    console.error(`\n${result.project}:`);
    for (const error of result.errors) console.error(error.text);
  }
  const allFiles = await listRepositoryFiles();
  const requiredFiles = allFiles.filter((file) =>
    matchesAny(file, COVERED_PATHS) &&
    (!selected || packageDirs.some((dir) => file.startsWith(`${dir}/`)))
  );
  const problems = [
    ...findCoverageProblems({
      requiredFiles,
      projects: new Map(results.map((result) => [
        result.project,
        result.files,
      ])),
      denoTypedProjects: projects.filter((project) =>
        readProjectTypes(project).includes("deno")
      ),
      ownership: OWNERSHIP,
      packageDirs,
      isDenoCheckInput: createDenoCheckInputTest(),
      exists: (glob) => {
        const pattern = globToRegExp(glob);
        return allFiles.some((file) => pattern.test(file));
      },
    }),
    ...guardDenoAccesses(results),
  ];
  if (problems.length > 0) {
    failed = true;
    console.error("");
    for (const problem of problems) console.error(problem);
  }
  return failed ? 1 : 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
