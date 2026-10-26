import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

function fixture(t, representation = "symlink") {
  const root = mkdtempSync(join(tmpdir(), "fedify-cli-skills-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = join(root, "packages/cli");
  const source = join(root, "claude-plugin/skills/fedify-cli");
  const skill = join(cli, "skills/fedify-cli");
  const script = join(cli, "scripts/pack-skills.mjs");
  mkdirSync(source, { recursive: true });
  mkdirSync(join(cli, "scripts"), { recursive: true });
  mkdirSync(join(cli, "skills"), { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "original skill\n");
  copyFileSync(new URL("./pack-skills.mjs", import.meta.url), script);
  const linkText = "../../../claude-plugin/skills/fedify-cli";
  function checkout() {
    if (representation === "symlink") {
      symlinkSync(
        process.platform === "win32" ? source : linkText,
        skill,
        process.platform === "win32" ? "junction" : "dir",
      );
    } else if (representation === "file") {
      // Preserve the exact bytes even when the checked-out text has CRLF.
      writeFileSync(skill, linkText + "\r\n");
    }
  }
  checkout();
  const original = representation === "symlink"
    ? readlinkSync(skill)
    : representation === "file"
    ? readFileSync(skill)
    : undefined;
  return {
    cli,
    checkout,
    original,
    source,
    skill,
    run: (command) => execFileSync(process.execPath, [script, command]),
  };
}

test("materializes the skill and its resources, then restores the link", (t) => {
  const { cli, original, source, skill, run } = fixture(t);
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
  strictEqual(readlinkSync(skill), original);
  ok(!existsSync(join(cli, ".skills-fedify-cli-symlink")));
  run("post");
  ok(lstatSync(skill).isSymbolicLink());
});

test("an interrupted pack refreshes the skill from its canonical source", (t) => {
  const { source, skill, run } = fixture(t);
  run("pre");
  writeFileSync(join(source, "SKILL.md"), "updated skill\n");
  run("pre");
  strictEqual(readFileSync(join(skill, "SKILL.md"), "utf8"), "updated skill\n");
  run("post");
  ok(lstatSync(skill).isSymbolicLink());
});

test("a real directory stays intact through packing", (t) => {
  const { cli, skill, run } = fixture(t, "directory");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "copied skill\n");
  run("pre");
  run("post");
  ok(lstatSync(skill).isDirectory());
  strictEqual(readFileSync(join(skill, "SKILL.md"), "utf8"), "copied skill\n");
  ok(!existsSync(join(cli, ".skills-fedify-cli-symlink")));
});

for (const representation of ["symlink", "file"]) {
  test(`${representation} checkout roundtrips after repeated prepack`, (t) => {
    const { cli, original, source, skill, run } = fixture(t, representation);
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
    if (representation === "file") {
      ok(lstatSync(skill).isFile());
      deepStrictEqual(readFileSync(skill), original);
    } else {
      strictEqual(readlinkSync(skill), original);
    }
    ok(!existsSync(join(cli, ".skills-fedify-cli-symlink")));
  });

  for (const state of ["original", "missing", "materialized"]) {
    for (const command of ["pre", "post"]) {
      test(`${command} recovers ${representation} with ${state} entry`, (t) => {
        const { cli, checkout, original, source, skill, run } = fixture(
          t,
          representation,
        );
        run("pre");
        if (state !== "materialized") {
          rmSync(skill, { recursive: true, force: true });
          if (state === "original") checkout();
        }
        // Simulate the completed temporary copy left before replacement.
        const temporary = `${skill}.tmp`;
        mkdirSync(temporary);
        writeFileSync(join(temporary, "SKILL.md"), "stale copy\n");
        writeFileSync(join(source, "SKILL.md"), "fresh source\n");
        run(command);
        if (command === "pre") {
          strictEqual(
            readFileSync(join(skill, "SKILL.md"), "utf8"),
            "fresh source\n",
          );
          run("post");
        }
        if (representation === "file") {
          ok(lstatSync(skill).isFile());
          deepStrictEqual(readFileSync(skill), original);
        } else {
          strictEqual(readlinkSync(skill), original);
        }
        ok(!existsSync(temporary));
        ok(!existsSync(join(cli, ".skills-fedify-cli-symlink")));
      });
    }
  }
}

test("recovers the empty sentinel left by older pack scripts", (t) => {
  const { cli, original, skill, run } = fixture(t);
  run("pre");
  writeFileSync(join(cli, ".skills-fedify-cli-symlink"), "");
  run("post");
  strictEqual(readlinkSync(skill), original);
});
