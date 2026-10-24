/**
 * This script checks that every changelog entry introduced by a pull request
 * references that pull request: the trailing references of the entry have to
 * include the pull request number, and the `links` frontmatter of its fragment
 * has to map that number to `https://github.com/fedify-dev/fedify/pull/<n>`.
 *
 * An entry is introduced by the pull request unless it existed before the
 * pull request, that is, at the merge base of the base and head revisions or
 * on the branches that the pull request merged in (see
 * {@link findIntroducedEntries}).  A pull request without any changelog
 * fragment passes.
 *
 * Usage:
 *
 * ~~~~ bash
 * deno run --allow-read --allow-run=git scripts/check_changelog_pr_refs.ts \
 *   --pr <number> --base <revision> [--head <revision>]
 * ~~~~
 */
import { parseArgs } from "node:util";
import { dirname, fromFileUrl, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

/** The directory that holds changelog fragments, relative to the root. */
export const FRAGMENTS_DIRECTORY = "changes.d";

/** The URL prefix of pull requests in the upstream repository. */
export const PULL_REQUEST_URL_PREFIX =
  "https://github.com/fedify-dev/fedify/pull/";

/** A problem found in a changelog fragment. */
export interface Violation {
  /** The fragment path, relative to the project root. */
  readonly path: string;
  /** A human-readable description of the problem and how to correct it. */
  readonly message: string;
}

function isFragmentPath(path: string): boolean {
  return path.startsWith(`${FRAGMENTS_DIRECTORY}/`) && path.endsWith(".md");
}

/**
 * Determine which entries of a fragment a pull request introduces.  An entry
 * existed before if an entry with the same first paragraph did, or failing
 * that, if it edits a previous entry with the same first line, so edits to
 * historical entries that keep their first line are not introduced.
 *
 * @param content The fragment content at the head of the pull request.
 * @param previous The contents the fragment had before the pull request: at
 *                 the merge base and on the branches the pull request merged
 *                 in.  Empty if the fragment did not exist before.
 * @returns `"all"` if the fragment did not exist before; otherwise, the
 *          0-based indices of the top-level list items it introduces.
 */
export function findIntroducedEntries(
  content: string,
  previous: readonly string[],
): "all" | Set<number> {
  if (previous.length < 1) return "all";
  const paragraphs = new Set<string>();
  const before = previous.flatMap(extractEntries).filter((entry) => {
    // The same entry usually appears in several previous revisions:
    if (paragraphs.has(entry.paragraph)) return false;
    paragraphs.add(entry.paragraph);
    return true;
  });
  const after = extractEntries(content);
  const matched = new Set<number>();
  const existing = new Set<number>();
  for (const key of ["paragraph", "firstLine"] as const) {
    after.forEach((entry, index) => {
      if (existing.has(index)) return;
      const origin = before.findIndex((old, i) =>
        !matched.has(i) && old[key] === entry[key]
      );
      if (origin < 0) return;
      matched.add(origin);
      existing.add(index);
    });
  }
  return new Set([...after.keys()].filter((index) => !existing.has(index)));
}

/** A top-level list item of a changelog fragment. */
interface Entry {
  /** The line holding the list marker, with its whitespace collapsed. */
  readonly firstLine: string;
  /** The first paragraph of the item, with its whitespace collapsed. */
  readonly paragraph: string;
}

/** The pieces of a changelog fragment relevant to this check. */
interface ParsedFragment {
  readonly links: Readonly<Record<string, unknown>> | null;
  readonly entries: readonly Entry[];
}

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---(?:\n|$)/;

function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function parseFragment(content: string): ParsedFragment | string {
  const text = normalizeNewlines(content);
  const frontmatter = FRONTMATTER_PATTERN.exec(text);
  let links: Record<string, unknown> | null = null;
  if (frontmatter != null) {
    let metadata: unknown;
    try {
      metadata = parseYaml(frontmatter[1]);
    } catch (error) {
      return `could not parse the frontmatter: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
    if (metadata != null && typeof metadata === "object") {
      const value = (metadata as Record<string, unknown>).links;
      if (value != null && typeof value === "object") {
        links = value as Record<string, unknown>;
      }
    }
  }
  return { links, entries: extractEntries(text) };
}

/** Return the top-level list items of a fragment, skipping frontmatter. */
function extractEntries(content: string): Entry[] {
  const text = normalizeNewlines(content);
  const frontmatter = FRONTMATTER_PATTERN.exec(text);
  const body = frontmatter == null ? text : text.slice(frontmatter[0].length);
  const items: string[][] = [];
  for (const line of body.split("\n")) {
    if (/^ {0,3}[-*+] /.test(line)) items.push([line]);
    else items.at(-1)?.push(line);
  }
  return items.map((lines) => {
    const trimmed = lines.map((line) => line.trim());
    // The first paragraph ends at a blank line or where a nested list starts:
    const end = trimmed.findIndex((line, index) =>
      index > 0 && (line === "" || /^(?:[-*+]|\d+[.)]) /.test(line))
    );
    const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
    return {
      firstLine: collapse(trimmed[0]),
      paragraph: collapse(
        trimmed.slice(0, end < 0 ? undefined : end).join(" ")
          .replace(/^[-*+] +/, ""),
      ),
    };
  });
}

/**
 * Matches the trailing reference group of a paragraph, such as
 * `[[#123], [#456] by John Doe]`.
 */
const TRAILING_REFERENCES_PATTERN =
  /\[(\[#\d+\](?:\s*,\s*\[#\d+\])*)(?:\s+by\s+[^\[\]]+)?\]\s*$/;

function extractTrailingReferences(paragraph: string): number[] | null {
  const match = TRAILING_REFERENCES_PATTERN.exec(paragraph);
  if (match == null) return null;
  return Array.from(match[1].matchAll(/\[#(\d+)\]/g), (m) => Number(m[1]));
}

/** Return the numbers of the pull requests that `links` points to. */
function findLinkedPullRequests(
  links: Readonly<Record<string, unknown>>,
): number[] {
  const numbers: number[] = [];
  for (const [key, url] of Object.entries(links)) {
    const keyMatch = /^#(\d+)$/.exec(key);
    if (keyMatch == null || typeof url !== "string") continue;
    if (url === `${PULL_REQUEST_URL_PREFIX}${keyMatch[1]}`) {
      numbers.push(Number(keyMatch[1]));
    }
  }
  return numbers;
}

/**
 * Check that the introduced entries of a changelog fragment reference the
 * current pull request.
 *
 * @param path The fragment path, used in the returned violations.
 * @param content The fragment content.
 * @param pullRequest The number of the current pull request.
 * @param entries The entries to check: `"all"`, or the 0-based indices of the
 *                introduced top-level list items as returned by
 *                {@link findIntroducedEntries}.
 * @returns The problems found, or an empty array if there are none.
 */
export function checkFragment(
  path: string,
  content: string,
  pullRequest: number,
  entries: "all" | ReadonlySet<number> = "all",
): Violation[] {
  const parsed = parseFragment(content);
  if (typeof parsed === "string") return [{ path, message: parsed }];
  const selected = parsed.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => entries === "all" || entries.has(index));

  const ref = `#${pullRequest}`;
  const expectedUrl = `${PULL_REQUEST_URL_PREFIX}${pullRequest}`;
  // Other entries' pull requests are not wrong predictions:
  const cited = new Set(
    selected.flatMap(({ entry }) =>
      extractTrailingReferences(entry.paragraph) ?? []
    ),
  );
  const otherPullRequests = parsed.links == null
    ? []
    : findLinkedPullRequests(parsed.links)
      .filter((number) => number !== pullRequest && cited.has(number));
  const predictionHint = otherPullRequests.length > 0
    ? `  It links to ${
      otherPullRequests.map((n) => `#${n}`).join(", ")
    } instead; if that number was predicted, replace it with ${ref} in both ` +
      "the links metadata and the trailing references."
    : "";

  const violations: Violation[] = [];
  const linked = parsed.links?.[ref];
  if (linked == null) {
    violations.push({
      path,
      message: `the links metadata has no entry for '${ref}'.  Add ` +
        `'${ref}': ${expectedUrl} under links.${predictionHint}`,
    });
  } else if (linked !== expectedUrl) {
    violations.push({
      path,
      message: `the links metadata maps '${ref}' to ${
        typeof linked === "string" ? linked : JSON.stringify(linked)
      }.  Change it to ${expectedUrl}.`,
    });
  }

  if (selected.length < 1) {
    violations.push({ path, message: "the fragment has no list entry." });
  }
  for (const { entry: { paragraph }, index } of selected) {
    const entry = parsed.entries.length > 1 ? `entry ${index + 1}` : "entry";
    const references = extractTrailingReferences(paragraph);
    if (references == null) {
      violations.push({
        path,
        message: `the ${entry} has no trailing references.  End its first ` +
          `paragraph with the accepted issue and the pull request, e.g., ` +
          `[[#123], [${ref}]].`,
      });
    } else if (!references.includes(pullRequest)) {
      violations.push({
        path,
        message:
          `the trailing references of the ${entry} (${
            references.map((n) => `[#${n}]`).join(", ")
          }) do not include the current pull request.  Add [${ref}] to ` +
          `them.${predictionHint}`,
      });
    }
  }
  return violations;
}

async function git(projectRoot: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("git", {
    args,
    cwd: projectRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  if (code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${decoder.decode(stderr)}`,
    );
  }
  return decoder.decode(stdout);
}

/** Options for {@link checkChangelogPrRefs}. */
export interface CheckOptions {
  /** The number of the current pull request. */
  readonly pullRequest: number;
  /** The base revision of the pull request. */
  readonly base: string;
  /** The head revision of the pull request. */
  readonly head: string;
}

/**
 * Check the changelog entries that a pull request introduces.
 *
 * @param projectRoot The root of the Git working tree.
 * @param options The pull request to check.
 * @returns The paths of the fragments holding introduced entries and the
 *          problems found in them.
 */
export async function checkChangelogPrRefs(
  projectRoot: string,
  options: CheckOptions,
): Promise<{ fragments: string[]; violations: Violation[] }> {
  const run = (...args: string[]) => git(projectRoot, args);
  const readFile = async (revision: string, path: string) => {
    try {
      return await run("show", `${revision}:${path}`);
    } catch {
      return null; // The file does not exist at the revision.
    }
  };
  const mergeBase = (await run("merge-base", options.base, options.head))
    .trim();
  // The other parents of the merge commits on the pull request branch, such as
  // the base branch merged in to resolve conflicts:
  const mergedIn = (await run(
    "rev-list",
    "--first-parent",
    "--merges",
    "--parents",
    `${mergeBase}..${options.head}`,
  )).split("\n").flatMap((line) => line.split(" ").slice(2));
  const diff = await run(
    "-c",
    "core.quotePath=false",
    "diff",
    "--name-status",
    "--find-renames",
    mergeBase,
    options.head,
    "--",
    FRAGMENTS_DIRECTORY,
  );
  const fragments: string[] = [];
  const violations: Violation[] = [];
  for (const line of diff.split("\n")) {
    // Each line is a status followed by the path, or by the old and new paths
    // of a rename:
    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);
    if (status.startsWith("D") || path == null || !isFragmentPath(path)) {
      continue;
    }
    const previous: string[] = [];
    for (const revision of [mergeBase, ...mergedIn]) {
      for (const oldPath of new Set(paths)) {
        const content = await readFile(revision, oldPath);
        if (content != null) previous.push(content);
      }
    }
    const content = await run("show", `${options.head}:${path}`);
    const entries = findIntroducedEntries(content, previous);
    if (entries !== "all" && entries.size < 1) continue;
    fragments.push(path);
    violations.push(
      ...checkFragment(path, content, options.pullRequest, entries),
    );
  }
  return { fragments, violations };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Deno.args,
    options: {
      pr: { type: "string" },
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
    },
  });
  const pullRequest = Number(values.pr);
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1 || !values.base) {
    console.error(
      "Usage: check_changelog_pr_refs.ts --pr <number> --base <revision> " +
        "[--head <revision>]",
    );
    Deno.exit(2);
  }
  const projectRoot = resolve(dirname(fromFileUrl(import.meta.url)), "..");
  const { fragments, violations } = await checkChangelogPrRefs(projectRoot, {
    pullRequest,
    base: values.base,
    head: values.head,
  });
  if (fragments.length < 1) {
    console.log("This pull request introduces no changelog entries.");
  }
  for (const { path, message } of violations) {
    console.error(`${path}: ${message}`);
  }
  if (violations.length > 0) Deno.exit(1);
  if (fragments.length > 0) {
    console.log(
      `All changelog entries introduced in ${fragments.length} fragment(s) ` +
        `reference #${pullRequest}.`,
    );
  }
}
