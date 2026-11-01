import {
  deepStrictEqual,
  match,
  rejects,
  strictEqual,
} from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import {
  checkChangelogPrRefs,
  checkFragment,
  findIntroducedEntries,
} from "./check_changelog_pr_refs.ts";

const execFileAsync = promisify(execFile);

const PATH = "changes.d/cli/foo.md";

function fragment(
  links: Record<string, string> | null,
  references: string,
): string {
  const frontmatter = links == null ? "" : [
    "---",
    "links:",
    ...Object.entries(links).map(([key, url]) => `  '${key}': ${url}`),
    "---",
    "",
  ].join("\n");
  return `${frontmatter} -  Fixed a bug where foo would bar.  ${references}\n`;
}

const issue = "https://github.com/fedify-dev/fedify/issues/123";
const pull = (n: number) => `https://github.com/fedify-dev/fedify/pull/${n}`;

describe("checkFragment()", () => {
  it("accepts a fragment that references the current pull request", () => {
    const content = fragment(
      { "#123": issue, "#456": pull(456) },
      "[[#123], [#456] by John Doe]",
    );
    deepStrictEqual(checkFragment(PATH, content, 456), []);
  });

  it("accepts references wrapped across lines", () => {
    const content = [
      "---",
      "links:",
      `  '#123': ${issue}`,
      `  '#456': ${pull(456)}`,
      "---",
      " -  Fixed a bug where foo would bar, which needs a long description",
      "    to wrap.  [[#123],",
      "    [#456]]",
      "",
      "    A second paragraph without references.",
      "",
    ].join("\n");
    deepStrictEqual(checkFragment(PATH, content, 456), []);
  });

  it("reports a missing pull request reference", () => {
    const content = fragment({ "#123": issue }, "[[#123]]");
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 2);
    for (const violation of violations) strictEqual(violation.path, PATH);
    match(violations[0].message, /no entry for '#456'/);
    match(
      violations[0].message,
      /'#456': https:\/\/github\.com\/.*\/pull\/456/,
    );
    match(violations[1].message, /do not include the current pull request/);
    match(violations[1].message, /Add \[#456\]/);
  });

  it("reports an entry without trailing references", () => {
    const content = fragment({ "#456": pull(456) }, "");
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 1);
    match(violations[0].message, /no trailing references/);
  });

  it("reports a fragment without links metadata", () => {
    const content = fragment(null, "[[#123], [#456]]");
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 1);
    match(violations[0].message, /no entry for '#456'/);
  });

  it("reports a wrong predicted pull request number", () => {
    const content = fragment(
      { "#123": issue, "#455": pull(455) },
      "[[#123], [#455]]",
    );
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 2);
    for (const { message } of violations) {
      match(message, /links to #455 instead/);
      match(message, /replace it with #456/);
    }
  });

  it("reports a links URL that does not point to the pull request", () => {
    const content = fragment(
      {
        "#123": issue,
        "#456": "https://github.com/fedify-dev/fedify/issues/456",
      },
      "[[#123], [#456]]",
    );
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 1);
    match(violations[0].message, /maps '#456' to .*\/issues\/456/);
    match(violations[0].message, /Change it to .*\/pull\/456/);
  });

  it("checks every entry of a fragment", () => {
    const content = [
      "---",
      "links:",
      `  '#456': ${pull(456)}`,
      "---",
      " -  Added foo.  [[#456]]",
      "",
      " -  Added bar.  [[#123]]",
      "",
    ].join("\n");
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 1);
    match(violations[0].message, /entry 2/);
  });

  it("checks only the given entries", () => {
    const content = [
      "---",
      "links:",
      `  '#7': ${pull(7)}`,
      "---",
      " -  Added foo.  [[#7]]",
      "",
      " -  Added bar.  [[#123]]",
      "",
    ].join("\n");
    const violations = checkFragment(PATH, content, 456, new Set([1]));
    strictEqual(violations.length, 2);
    match(violations[0].message, /no entry for '#456'/);
    match(violations[1].message, /entry 2/);
  });

  it("accepts references followed directly by a nested list", () => {
    const content = [
      "---",
      "links:",
      `  '#456': ${pull(456)}`,
      "---",
      " -  Added options.  [[#123], [#456]]",
      "     -  `foo` option.",
      "     -  `bar` option.",
      "",
    ].join("\n");
    deepStrictEqual(checkFragment(PATH, content, 456), []);
  });

  it("hints only at pull requests the checked entries cite", () => {
    const content = [
      "---",
      "links:",
      `  '#7': ${pull(7)}`,
      "---",
      " -  Added foo.  [[#7]]",
      "",
      " -  Added bar.  [[#123]]",
      "",
    ].join("\n");
    const violations = checkFragment(PATH, content, 456, new Set([1]));
    strictEqual(violations.length, 2);
    for (const { message } of violations) {
      strictEqual(message.includes("links to #7"), false, message);
    }
  });

  it("accepts references to advisories and escaped brackets", () => {
    const content = [
      "---",
      "links:",
      `  '#456': ${pull(456)}`,
      "---",
      " -  Fixed a bug where foo would bar.",
      "    \\[[GHSA-4qhx-hhwf-8685], [#123], [#456]]",
      "",
    ].join("\n");
    deepStrictEqual(checkFragment(PATH, content, 456), []);
  });

  it("reports references to advisories without the pull request", () => {
    const content = fragment(
      { "#456": pull(456) },
      "[[GHSA-4qhx-hhwf-8685]]",
    );
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 1);
    match(
      violations[0].message,
      /references of the entry \(\[GHSA-4qhx-hhwf-8685\]\) do not include/,
    );
  });

  it("reports malformed frontmatter", () => {
    const content = "---\nlinks: [\n---\n -  Added foo.  [[#456]]\n";
    const violations = checkFragment(PATH, content, 456);
    strictEqual(violations.length, 1);
    match(violations[0].message, /could not parse the frontmatter/);
  });
});

describe("findIntroducedEntries()", () => {
  it("introduces every entry of a new fragment", () => {
    strictEqual(findIntroducedEntries(" -  Added foo.  [[#456]]\n", []), "all");
  });

  it("introduces only entries that did not exist before", () => {
    const before = " -  Added foo.  [[#1]]\n\n -  Added bar.  [[#2]]\n";
    const after = " -  Added bar.  [[#2]]\n\n -  Added baz.  [[#456]]\n\n" +
      " -  Added foo.  [[#1]]\n";
    deepStrictEqual(findIntroducedEntries(after, [before]), new Set([1]));
  });

  it("treats entries on any previous revision as existing", () => {
    const after = " -  Added foo.  [[#1]]\n\n -  Added bar.  [[#2]]\n";
    deepStrictEqual(
      findIntroducedEntries(after, [
        " -  Added foo.  [[#1]]\n",
        " -  Added bar.  [[#2]]\n",
      ]),
      new Set(),
    );
  });

  it("treats entries edited after their first line as existing", () => {
    const before = " -  Added foo,\n    and bar.  [[#1]]\n";
    const after = " -  Added foo,\n    bar, and baz.  [[#1]]\n";
    deepStrictEqual(findIntroducedEntries(after, [before]), new Set());
  });

  it("introduces new entries sharing a first line with an existing one", () => {
    const old = " -  Fixed a bug.\n    Foo failed.  [[#1]]\n";
    const twin = " -  Fixed a bug.\n    Bar failed.  [[#2]]\n";
    deepStrictEqual(
      findIntroducedEntries(`${twin}\n${old}`, [old]),
      new Set([0]),
    );
    deepStrictEqual(
      findIntroducedEntries(`${old}\n${twin}`, [old, old]),
      new Set([1]),
    );
  });

  it("treats entries keeping their trailing references as existing", () => {
    deepStrictEqual(
      findIntroducedEntries(" -  Fixed a typo.  [[#7]]\n", [
        " -  Fixed a bug.  [[#7]]\n",
      ]),
      new Set(),
    );
  });

  it("treats entries in previous changelogs as existing", () => {
    const changelog = "Version 1.0.1\n-------------\n\n" +
      " -  Fixed a bug.  [[#5], [#7]]\n\n -  Fixed foo.  [[#8]]\n";
    deepStrictEqual(
      findIntroducedEntries(" -  Fixed a bug.\n    [[#5], [#7]]\n", [], [
        changelog,
      ]),
      new Set(),
    );
    // Only the same first paragraph counts, since changelog entries often
    // share their trailing references:
    deepStrictEqual(
      findIntroducedEntries(
        " -  Fixed a bug.  [[#5], [#7]]\n\n -  Fixed bar.  [[#8]]\n",
        [],
        [changelog],
      ),
      new Set([1]),
    );
  });

  it("ignores the order of trailing references", () => {
    deepStrictEqual(
      findIntroducedEntries(" -  Fixed a typo.  [[#7], [#5]]\n", [
        " -  Fixed a bug.  [[#5], [#7]]\n",
      ]),
      new Set(),
    );
  });

  it("pairs edited entries by their first line before their references", () => {
    // A new entry copying the trailing references of an entry edited in the
    // same pull request must not take the edited entry's place:
    deepStrictEqual(
      findIntroducedEntries(
        " -  Added baz.  [[#5], [#7]]\n\n" +
          " -  Fixed a bug in foo.\n    Details.  [[#5], [#7]]\n",
        [" -  Fixed a bug in foo.\n    Detail.  [[#5], [#7]]\n"],
      ),
      new Set([0]),
    );
  });

  it("reports one of the entries sharing references with a new one", () => {
    // Entries sharing their references are paired in order, so when edited
    // entries and a new one share them, one of them is still left unpaired:
    const introduced = findIntroducedEntries(
      " -  Changed foo.  [[#5], [#7]]\n\n -  Added baz.  [[#5], [#7]]\n\n" +
        " -  Changed bar.  [[#5], [#7]]\n",
      [" -  Fixed foo.  [[#5], [#7]]\n\n -  Fixed bar.  [[#5], [#7]]\n"],
    );
    strictEqual(introduced instanceof Set && introduced.size, 1);
  });

  it("treats changelog entries citing only advisories as existing", () => {
    const changelog = "Version 1.0.1\n-------------\n\n" +
      " -  Fixed foo.  \\[[GHSA-r48c-xx2h-fv4g]]\n";
    deepStrictEqual(
      findIntroducedEntries(
        " -  Fixed foo.\n    \\[[GHSA-r48c-xx2h-fv4g]]\n",
        [],
        [
          changelog,
        ],
      ),
      new Set(),
    );
  });

  it("pairs edited entries citing only advisories by their references", () => {
    // As when a carried security fix is reworded afterward:
    deepStrictEqual(
      findIntroducedEntries(
        " -  Fixed an SSRF vulnerability.\n    [[GHSA-r48c-xx2h-fv4g]]\n",
        [" -  Fixed a server-side request forgery.\n    [[GHSA-r48c-xx2h-fv4g]]\n"],
      ),
      new Set(),
    );
  });

  it("does not treat changelog entries without references as existing", () => {
    deepStrictEqual(
      findIntroducedEntries(" -  Updated dependencies.\n", [], [
        "Version 1.0.0\n-------------\n\n -  Updated dependencies.\n",
      ]),
      "all",
    );
  });

  it("does not pair entries without trailing references", () => {
    deepStrictEqual(
      findIntroducedEntries(" -  Fixed bar.\n", [" -  Fixed foo.\n"]),
      new Set([0]),
    );
  });

  it("ignores rewrapped entries", () => {
    const before = " -  Fixed a bug where foo would bar.  [[#1]]\n";
    const after = " -  Fixed a bug where foo\n    would bar.  [[#1]]\n";
    deepStrictEqual(findIntroducedEntries(after, [before]), new Set());
  });
});

describe("checkChangelogPrRefs()", () => {
  const valid = fragment(
    { "#123": issue, "#456": pull(456) },
    "[[#123], [#456]]",
  );
  const historical = [
    "---",
    "links:",
    `  '#7': ${pull(7)}`,
    "---",
    " -  Fixed a bug where foo would bar, which was fixed",
    "    long ago.  [[#7]]",
    "",
  ].join("\n");
  const historicalPath = "changes.d/cli/historical.md";

  /** Append a new top-level entry to the historical fragment. */
  const withNewEntry = (links: string, references: string) =>
    historical.replace("---\n -", `${links}---\n -`) +
    `\n -  Added baz.  ${references}\n`;

  async function git(root: string, ...args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "tag.gpgSign=false",
        "-c",
        "core.hooksPath=/dev/null",
        // Keep line endings as written, since a test edits a merged file:
        "-c",
        "core.autocrlf=false",
        // Keep objects loose, since a test removes one of them:
        "-c",
        "gc.auto=0",
        ...args,
      ], { cwd: root, encoding: "utf8" });
      return stdout.trim();
    } catch (error) {
      throw new Error((error as { stderr?: string }).stderr ?? String(error));
    }
  }

  async function commit(
    root: string,
    files: Record<string, string | null>,
  ): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      if (content == null) {
        await git(root, "rm", "--quiet", path);
      } else {
        await mkdir(join(root, dirname(path)), { recursive: true });
        await writeFile(join(root, path), content);
        await git(root, "add", path);
      }
    }
    await git(root, "commit", "--quiet", "--allow-empty", "-m", "commit");
  }

  /**
   * Set up a repository whose `main` branch contains a historical fragment
   * and `files`, check out a `pr` branch from it, and run `scenario` on that
   * branch.
   */
  async function withRepository(
    scenario: (root: string) => Promise<void>,
    files: Record<string, string> = {},
  ): Promise<Awaited<ReturnType<typeof checkChangelogPrRefs>>> {
    const root = await mkdtemp(join(tmpdir(), "fedify-changelog-pr-refs-"));
    try {
      await git(root, "init", "--quiet", "--initial-branch=main");
      await commit(root, {
        "changes.d/next.txt": "1.0.0\n",
        [historicalPath]: historical,
        ...files,
      });
      await git(root, "switch", "--quiet", "-c", "pr");
      await scenario(root);
      return await checkChangelogPrRefs(root, {
        pullRequest: 456,
        base: "main",
        head: "pr",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("passes a pull request without changelog fragments", async () => {
    const result = await withRepository(async (root) => {
      await commit(root, { "src/foo.ts": "export {};\n" });
    });
    deepStrictEqual(result, { fragments: [], violations: [] });
  });

  it("checks fragments added by the pull request", async () => {
    const result = await withRepository(async (root) => {
      await commit(root, {
        "changes.d/cli/valid.md": valid,
        "changes.d/fedify/invalid.md": fragment({ "#123": issue }, "[[#123]]"),
      });
    });
    deepStrictEqual(result.fragments, [
      "changes.d/cli/valid.md",
      "changes.d/fedify/invalid.md",
    ]);
    deepStrictEqual(
      [...new Set(result.violations.map((v) => v.path))],
      ["changes.d/fedify/invalid.md"],
    );
  });

  it("checks later edits to fragments added by the pull request", async () => {
    const result = await withRepository(async (root) => {
      await commit(root, { "changes.d/cli/foo.md": valid });
      await commit(root, {
        "changes.d/cli/foo.md": fragment({ "#123": issue }, "[[#123]]"),
      });
    });
    deepStrictEqual(result.fragments, ["changes.d/cli/foo.md"]);
    strictEqual(result.violations.length, 2);
  });

  it("follows renames of fragments added by the pull request", async () => {
    const result = await withRepository(async (root) => {
      await commit(root, { "changes.d/cli/foo.md": valid });
      await git(root, "mv", "changes.d/cli/foo.md", "changes.d/cli/bar.md");
      await commit(root, {});
    });
    deepStrictEqual(result, {
      fragments: ["changes.d/cli/bar.md"],
      violations: [],
    });
  });

  it("checks entries added to historical fragments", async () => {
    const invalid = await withRepository(async (root) => {
      await commit(root, { [historicalPath]: withNewEntry("", "[[#123]]") });
    });
    deepStrictEqual(invalid.fragments, [historicalPath]);
    strictEqual(invalid.violations.length, 2);
    match(invalid.violations[0].message, /no entry for '#456'/);
    match(invalid.violations[1].message, /entry 2 \(\[#123\]\)/);

    const valid = await withRepository(async (root) => {
      await commit(root, {
        [historicalPath]: withNewEntry(
          `  '#456': ${pull(456)}\n`,
          "[[#123], [#456]]",
        ),
      });
    });
    deepStrictEqual(valid, { fragments: [historicalPath], violations: [] });
  });

  it("checks later edits to entries added to historical fragments", async () => {
    const result = await withRepository(async (root) => {
      await commit(root, { [historicalPath]: withNewEntry("", "[[#123]]") });
      await commit(root, {
        [historicalPath]: withNewEntry(
          `  '#456': ${pull(456)}\n`,
          "[[#123], [#456]]",
        ),
      });
    });
    deepStrictEqual(result, { fragments: [historicalPath], violations: [] });
  });

  it("excludes historical fragments renamed", async () => {
    const result = await withRepository(async (root) => {
      await mkdir(join(root, "changes.d", "fedify"));
      await git(
        root,
        "mv",
        historicalPath,
        "changes.d/fedify/historical.md",
      );
      await commit(root, {});
    });
    deepStrictEqual(result, { fragments: [], violations: [] });
  });

  it("excludes historical entries edited after their first line", async () => {
    for (
      const edited of [
        historical.replace("long ago", "a while ago"),
        `${historical}\n     -  Also fixed baz.\n`,
        historical.replace(
          "which was fixed\n    long",
          "which was\n    fixed long",
        ),
      ]
    ) {
      const result = await withRepository(async (root) => {
        await commit(root, { [historicalPath]: edited });
      });
      deepStrictEqual(result, { fragments: [], violations: [] });
    }
  });

  it("excludes historical entries whose first line is edited", async () => {
    const result = await withRepository(async (root) => {
      await commit(root, {
        [historicalPath]: historical.replace("foo would bar", "foo would baz"),
      });
    });
    deepStrictEqual(result, { fragments: [], violations: [] });

    const path = "changes.d/cli/one-line.md";
    const oneLine = `---\nlinks:\n  '#7': ${pull(7)}\n---\n` +
      " -  Fixed a bug.  [[#7]]\n";
    const typo = await withRepository(async (root) => {
      await commit(root, { [path]: oneLine.replace("a bug", "a typo") });
    }, { [path]: oneLine });
    deepStrictEqual(typo, { fragments: [], violations: [] });
  });

  it("checks new entries replacing historical ones", async () => {
    const result = await withRepository(async (root) => {
      await commit(root, {
        [historicalPath]: historical.replace(
          /---\n -[^]*$/,
          "---\n -  Fixed a crash in the inbox handler.  [[#9]]\n",
        ),
      });
    });
    deepStrictEqual(result.fragments, [historicalPath]);
    strictEqual(result.violations.length, 2);
    match(result.violations[0].message, /no entry for '#456'/);
    match(result.violations[1].message, /entry \(\[#9\]\)/);

    const path = "changes.d/fedify/method.md";
    const similar = await withRepository(async (root) => {
      await commit(root, {
        [path]: " -  Added `Context.bar()` method.  [[#123]]\n",
      });
    }, { [path]: " -  Added `Federation.foo()` method.  [[#7]]\n" });
    deepStrictEqual(similar.fragments, [path]);
    strictEqual(similar.violations.length, 2);
    match(similar.violations[1].message, /entry \(\[#123\]\)/);
  });

  it("checks new entries sharing the first paragraph of a historical entry", async () => {
    const path = "changes.d/fedify/apis.md";
    const entry = (references: string, api: string) =>
      ` -  Added new APIs.  ${references}\n\n     -  \`${api}()\`\n`;
    const result = await withRepository(async (root) => {
      await commit(root, {
        [path]: `${entry("[[#123]]", "bar")}\n${entry("[[#7]]", "foo")}`,
      });
    }, { [path]: entry("[[#7]]", "foo") });
    deepStrictEqual(result.fragments, [path]);
    strictEqual(result.violations.length, 2);
    match(result.violations[1].message, /entry 1 \(\[#123\]\)/);
  });

  it("excludes historical entries moved within a fragment", async () => {
    const path = "changes.d/cli/two.md";
    const result = await withRepository(async (root) => {
      await commit(root, {
        [path]: " -  Added bar.  [[#2]]\n\n -  Added foo.  [[#1]]\n",
      });
    }, { [path]: " -  Added foo.  [[#1]]\n\n -  Added bar.  [[#2]]\n" });
    deepStrictEqual(result, { fragments: [], violations: [] });
  });

  it("checks new entries sharing the first line of a historical entry", async () => {
    const twin = " -  Fixed a bug where foo would bar, which was fixed\n" +
      "    just now.  [[#123]]\n";
    const appended = await withRepository(async (root) => {
      await commit(root, { [historicalPath]: `${historical}\n${twin}` });
    });
    deepStrictEqual(appended.fragments, [historicalPath]);
    strictEqual(appended.violations.length, 2);
    match(appended.violations[0].message, /no entry for '#456'/);
    match(appended.violations[1].message, /entry 2 \(\[#123\]\)/);

    const prepended = await withRepository(async (root) => {
      await commit(root, {
        [historicalPath]: historical.replace("---\n -", `---\n${twin}\n -`),
      });
    });
    deepStrictEqual(prepended.fragments, [historicalPath]);
    strictEqual(prepended.violations.length, 2);
    match(prepended.violations[0].message, /no entry for '#456'/);
    match(prepended.violations[1].message, /entry 1 \(\[#123\]\)/);
  });

  it("excludes entries carried forward through a merge", async () => {
    const result = await withRepository(async (root) => {
      await git(root, "switch", "--quiet", "-c", "maintenance", "main");
      await commit(root, {
        "changes.d/cli/backport.md": historical,
        [historicalPath]: withNewEntry("", "[[#8]]"),
      });
      await git(root, "switch", "--quiet", "pr");
      await git(
        root,
        "merge",
        "--quiet",
        "--no-ff",
        "-m",
        "merge",
        "maintenance",
      );
      await commit(root, { "changes.d/cli/foo.md": valid });
    });
    deepStrictEqual(result, {
      fragments: ["changes.d/cli/foo.md"],
      violations: [],
    });
  });

  it("follows introduced entries moved by a merge", async () => {
    const result = await withRepository(async (root) => {
      await git(root, "switch", "--quiet", "-c", "maintenance", "main");
      await commit(root, {
        [historicalPath]: historical.replace(
          "---\n -",
          "---\n -  Added qux.  [[#8]]\n\n -",
        ),
      });
      await git(root, "switch", "--quiet", "pr");
      await commit(root, {
        [historicalPath]: `${historical}\n -  Added baz.  [[#123], [#456]]\n`,
      });
      await git(
        root,
        "merge",
        "--quiet",
        "--no-ff",
        "-m",
        "merge",
        "maintenance",
      );
      const merged = await readFile(join(root, historicalPath), "utf8");
      await commit(root, {
        [historicalPath]: merged.replace(
          "\n---\n",
          `\n  '#456': ${pull(456)}\n---\n`,
        ),
      });
    });
    deepStrictEqual(result, { fragments: [historicalPath], violations: [] });
  });

  it("excludes entries merged into fragments added by the pull request", async () => {
    const path = "changes.d/cli/foo.md";
    const result = await withRepository(async (root) => {
      await git(root, "switch", "--quiet", "-c", "maintenance", "main");
      await commit(root, { [path]: " -  Added qux.  [[#8]]\n" });
      await git(root, "switch", "--quiet", "pr");
      await commit(root, { [path]: valid });
      await git(
        root,
        "merge",
        "--quiet",
        "--no-ff",
        "--no-commit",
        "--strategy=ours",
        "maintenance",
      );
      await commit(root, { [path]: `${valid}\n -  Added qux.  [[#8]]\n` });
    });
    deepStrictEqual(result, { fragments: [path], violations: [] });
  });

  it("excludes entries restored by sacho carry", async () => {
    const links = [
      "---",
      "links:",
      "  '#5': https://github.com/fedify-dev/fedify/issues/5",
      `  '#7': ${pull(7)}`,
      "---",
      "",
    ].join("\n");
    const released = [
      "Changelog",
      "=========",
      "",
      "Version 1.0.1",
      "-------------",
      "",
      "Released on October 2, 2026.",
      "",
      " -  Fixed a bug.  [[#5], [#7]]",
      "",
      "[#5]: https://github.com/fedify-dev/fedify/issues/5",
      `[#7]: ${pull(7)}`,
      "",
    ].join("\n");
    // `sacho carry` rewraps the entry it restores:
    const carried = `${links} -  Fixed a bug.\n    [[#5], [#7]]\n`;
    const carriedPath = "changes.d/carried-from-1.0.1.md";
    const check = (content: string) =>
      withRepository(async (root) => {
        await git(root, "switch", "--quiet", "-c", "maintenance", "main");
        await commit(root, {
          "changes.d/cli/fix-foo.md":
            `${links} -  Fixed a bug.  [[#5], [#7]]\n`,
        });
        // `sacho release` consumes the fragment into a released section:
        await commit(root, {
          "changes.d/cli/fix-foo.md": null,
          "CHANGES.md": released,
        });
        await git(root, "tag", "1.0.1");
        await git(root, "switch", "--quiet", "pr");
        await git(root, "merge", "--quiet", "--no-ff", "-m", "m", "1.0.1");
        await commit(root, { [carriedPath]: content });
      });

    deepStrictEqual(await check(carried), { fragments: [], violations: [] });
    // Sacho suggests editing carried fragments as the branch needs:
    deepStrictEqual(await check(carried.replace("a bug", "a typo")), {
      fragments: [],
      violations: [],
    });
    const extended = await check(`${carried}\n -  Added baz.  [[#123]]\n`);
    deepStrictEqual(extended.fragments, [carriedPath]);
    strictEqual(extended.violations.length, 2);
    match(extended.violations[1].message, /entry 2 \(\[#123\]\)/);
  });

  it("does not treat the unreleased section of the changelog as history", async () => {
    // Sacho materializes the fragments, including new ones, in the changelog,
    // whatever its unreleased heading says:
    for (const heading of ["To be released.", "Unreleased."]) {
      const result = await withRepository(async (root) => {
        await commit(root, {
          "changes.d/cli/baz.md": " -  Added baz.  [[#123]]\n",
          "CHANGES.md": `Version 1.1.0\n-------------\n\n${heading}\n\n` +
            " -  Added baz.  [[#123]]\n",
        });
      });
      deepStrictEqual(result.fragments, ["changes.d/cli/baz.md"]);
      strictEqual(result.violations.length, 2);
    }
  });

  it("reports errors without a stack trace", () => {
    const { status, stderr: message } = spawnSync(process.execPath, [
      "--experimental-strip-types",
      // The root package.json does not declare the module type:
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      join(import.meta.dirname!, "check_changelog_pr_refs.ts"),
      "--pr",
      "1",
      "--base",
      "no-such-revision",
    ], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
    strictEqual(status, 2);
    match(message, /^error: git merge-base no-such-revision HEAD failed/);
    strictEqual(/^\s+at /m.test(message), false, message);
  });

  it("propagates Git errors other than missing files", async () => {
    await rejects(
      withRepository(async (root) => {
        await commit(root, { [historicalPath]: withNewEntry("", "[[#123]]") });
        // Lose the historical fragment's content at the merge base:
        const blob = await git(root, "rev-parse", `main:${historicalPath}`);
        await rm(
          join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2)),
        );
      }),
      /git show .* failed/,
    );
  });

  it("ignores fragments deleted by a merge", async () => {
    const result = await withRepository(async (root) => {
      await git(root, "switch", "--quiet", "-c", "maintenance", "main");
      await commit(root, { [historicalPath]: null });
      await git(root, "switch", "--quiet", "pr");
      await commit(root, { [historicalPath]: withNewEntry("", "[[#123]]") });
      await git(
        root,
        "merge",
        "--quiet",
        "--no-ff",
        "--no-commit",
        "--strategy=ours",
        "maintenance",
      );
      await commit(root, { [historicalPath]: null });
    });
    deepStrictEqual(result, { fragments: [], violations: [] });
  });
});
