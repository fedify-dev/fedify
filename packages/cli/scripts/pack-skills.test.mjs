import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

function fixture(
  t,
  representation = process.platform === "win32"
    ? "junction"
    : "relative-symlink",
) {
  const root = mkdtempSync(join(tmpdir(), "fedify-cli-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = join(root, "packages/cli");
  const source = join(root, "claude-plugin/skills/fedify-cli");
  const skill = join(cli, "skills/fedify-cli");
  const script = join(cli, "scripts/pack-skills.mjs");
  const sentinel = join(cli, ".skills-fedify-cli-symlink");
  const backup = join(cli, ".skills-fedify-cli-original");
  mkdirSync(source, { recursive: true });
  mkdirSync(join(cli, "scripts"), { recursive: true });
  mkdirSync(join(cli, "skills"), { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "original skill\n");
  copyFileSync(new URL("./pack-skills.mjs", import.meta.url), script);
  const linkText = "../../../claude-plugin/skills/fedify-cli";
  try {
    if (representation === "junction") {
      symlinkSync(source, skill, "junction");
    } else if (representation.endsWith("symlink")) {
      symlinkSync(
        representation === "absolute-symlink" ? source : linkText,
        skill,
        "dir",
      );
    } else if (representation === "file") {
      // Preserve the exact bytes even when the checked-out text has CRLF.
      writeFileSync(skill, linkText + "\r\n", { mode: 0o640 });
    }
  } catch (error) {
    if (
      process.platform === "win32" &&
      representation.endsWith("symlink") &&
      ["EPERM", "EACCES"].includes(error.code)
    ) {
      t.skip(`Windows symlink creation requires privileges: ${error.code}`);
      return undefined;
    }
    throw error;
  }
  const originalStat =
    representation === "directory" ? undefined : lstatSync(skill);
  const original = originalStat?.isSymbolicLink()
    ? readlinkSync(skill)
    : originalStat?.isFile()
      ? readFileSync(skill)
      : undefined;
  return {
    cli,
    original,
    source,
    skill,
    sentinel,
    backup,
    assertOriginal() {
      const restored = lstatSync(skill);
      // Rename retains the actual filesystem entry, including its Windows
      // reparse-point kind; equal link text alone cannot distinguish junctions.
      strictEqual(restored.dev, originalStat.dev);
      strictEqual(restored.ino, originalStat.ino);
      strictEqual(restored.mode, originalStat.mode);
      if (representation === "file") {
        ok(restored.isFile());
        deepStrictEqual(readFileSync(skill), original);
      } else {
        ok(restored.isSymbolicLink());
        strictEqual(readlinkSync(skill), original);
      }
      ok(!existsSync(sentinel));
      // lstat also catches a dangling parked relative symlink.
      throws(() => lstatSync(backup), { code: "ENOENT" });
    },
    run: (command) =>
      execFileSync(process.execPath, [script, command], { stdio: "pipe" }),
  };
}

test("materializes the skill and its resources, then restores the link", (t) => {
  const { source, skill, run, assertOriginal } = fixture(t);
  mkdirSync(join(source, "references"));
  writeFileSync(join(source, "references/commands.md"), "reference\n");
  run("pre");
  ok(lstatSync(skill).isDirectory());
  strictEqual(
    readFileSync(join(skill, "SKILL.md"), "utf8"),
    "original skill\n",
  );
  strictEqual(
    readFileSync(join(skill, "references/commands.md"), "utf8"),
    "reference\n",
  );
  run("post");
  assertOriginal();
  run("post");
  assertOriginal();
});

test("an interrupted pack refreshes the skill from its canonical source", (t) => {
  const { source, skill, run, assertOriginal } = fixture(t);
  run("pre");
  writeFileSync(join(source, "SKILL.md"), "updated skill\n");
  run("pre");
  strictEqual(readFileSync(join(skill, "SKILL.md"), "utf8"), "updated skill\n");
  run("post");
  assertOriginal();
});

test("a real directory stays intact through packing", (t) => {
  const { skill, sentinel, backup, run } = fixture(t, "directory");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "copied skill\n");
  run("pre");
  run("post");
  ok(lstatSync(skill).isDirectory());
  strictEqual(readFileSync(join(skill, "SKILL.md"), "utf8"), "copied skill\n");
  ok(!existsSync(sentinel));
  ok(!existsSync(backup));
});

const representations = ["relative-symlink", "absolute-symlink", "file"];
if (process.platform === "win32") representations.push("junction");
for (const representation of representations) {
  test(`${representation} checkout roundtrips after repeated prepack`, (t) => {
    const prepared = fixture(t, representation);
    if (!prepared) return;
    const { source, skill, run, assertOriginal } = prepared;
    run("pre");
    ok(lstatSync(skill).isDirectory());
    strictEqual(
      readFileSync(join(skill, "SKILL.md"), "utf8"),
      "original skill\n",
    );
    writeFileSync(join(source, "SKILL.md"), "updated skill\n");
    run("pre");
    strictEqual(
      readFileSync(join(skill, "SKILL.md"), "utf8"),
      "updated skill\n",
    );
    run("post");
    assertOriginal();
  });

  for (const state of ["original", "saved", "materialized", "restored"]) {
    for (const command of ["pre", "post"]) {
      test(`${command} recovers ${representation} with ${state} entry`, (t) => {
        const prepared = fixture(t, representation);
        if (!prepared) return;
        const { sentinel, backup, source, skill, run, assertOriginal } =
          prepared;
        const temporary = `${skill}.tmp`;
        mkdirSync(temporary);
        writeFileSync(join(temporary, "SKILL.md"), "stale copy\n");
        writeFileSync(sentinel, JSON.stringify({ type: "saved-entry" }));
        if (state !== "original") renameSync(skill, backup);
        if (state === "materialized") {
          mkdirSync(skill);
          writeFileSync(join(skill, "SKILL.md"), "stale materialization\n");
        } else if (state === "restored") {
          renameSync(backup, skill);
        }
        writeFileSync(join(source, "SKILL.md"), "fresh source\n");
        run(command);
        if (command === "pre") {
          strictEqual(
            readFileSync(join(skill, "SKILL.md"), "utf8"),
            "fresh source\n",
          );
          run("post");
        }
        assertOriginal();
        ok(!existsSync(temporary));
      });
    }
  }
}

test("refuses to overwrite an unrelated saved entry", (t) => {
  const { skill, sentinel, backup, run, assertOriginal } = fixture(t);
  writeFileSync(backup, "unrelated data\n");
  const originalLink = readlinkSync(skill);
  throws(() => run("pre"), /no matching sentinel/);
  strictEqual(readFileSync(backup, "utf8"), "unrelated data\n");
  strictEqual(readlinkSync(skill), originalLink);
  ok(!existsSync(sentinel));
  rmSync(backup);
  assertOriginal();
});

for (const state of ["missing", "directory"]) {
  test(`keeps recovery data when the saved entry is absent and ${state}`, (t) => {
    const { skill, sentinel, run } = fixture(t);
    rmSync(skill, { force: true });
    if (state === "directory") {
      mkdirSync(skill);
      writeFileSync(join(skill, "SKILL.md"), "keep me\n");
    }
    writeFileSync(sentinel, JSON.stringify({ type: "saved-entry" }));
    throws(() => run("post"), /saved skills\/fedify-cli entry is missing/);
    ok(existsSync(sentinel));
    if (state === "directory") {
      strictEqual(readFileSync(join(skill, "SKILL.md"), "utf8"), "keep me\n");
    }
  });
}

test("refuses a saved directory instead of replacing the current entry", (t) => {
  const { skill, sentinel, backup, run } = fixture(t);
  const originalLink = readlinkSync(skill);
  mkdirSync(backup);
  writeFileSync(join(backup, "keep.txt"), "keep me\n");
  writeFileSync(sentinel, JSON.stringify({ type: "saved-entry" }));
  throws(
    () => run("post"),
    /saved skills\/fedify-cli entry is not a link or file/,
  );
  strictEqual(readlinkSync(skill), originalLink);
  strictEqual(readFileSync(join(backup, "keep.txt"), "utf8"), "keep me\n");
  ok(existsSync(sentinel));
});

test("refuses a saved entry with a legacy sentinel", (t) => {
  const { skill, sentinel, backup, run } = fixture(t);
  const originalLink = readlinkSync(skill);
  writeFileSync(backup, "keep me\n");
  writeFileSync(sentinel, "");
  throws(() => run("post"), /no matching sentinel/);
  strictEqual(readlinkSync(skill), originalLink);
  strictEqual(readFileSync(backup, "utf8"), "keep me\n");
  ok(existsSync(sentinel));
});

test("recovers the empty sentinel left by older pack scripts", (t) => {
  const { original, sentinel, skill, run } = fixture(t);
  rmSync(skill, { force: true });
  mkdirSync(skill);
  writeFileSync(sentinel, "");
  run("post");
  strictEqual(readlinkSync(skill), original);
  ok(!existsSync(sentinel));
});

for (const representation of ["file", "symlink"]) {
  test(`recovers a legacy ${representation} sentinel`, (t) => {
    const { original, sentinel, skill, run } = fixture(
      t,
      representation === "file" ? "file" : undefined,
    );
    const record =
      representation === "file"
        ? {
            type: "file",
            contents: original.toString("base64"),
            mode: lstatSync(skill).mode,
          }
        : { type: "symlink", target: original };
    rmSync(skill, { force: true });
    mkdirSync(skill);
    writeFileSync(sentinel, JSON.stringify(record));
    run("post");
    if (representation === "file") {
      deepStrictEqual(readFileSync(skill), original);
    } else {
      strictEqual(readlinkSync(skill), original);
    }
    ok(!existsSync(sentinel));
  });
}
