import { ok, strictEqual } from "node:assert/strict";
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

function fixture(t, symlink = true) {
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
  if (symlink) {
    symlinkSync("../../../claude-plugin/skills/fedify-cli", skill, "dir");
  }
  return {
    cli,
    source,
    skill,
    run: (command) => execFileSync(process.execPath, [script, command]),
  };
}

test("materializes the skill and its resources, then restores the link", (t) => {
  const { cli, source, skill, run } = fixture(t);
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
  strictEqual(readlinkSync(skill), "../../../claude-plugin/skills/fedify-cli");
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
  const { cli, skill, run } = fixture(t, false);
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "copied skill\n");
  run("pre");
  run("post");
  ok(lstatSync(skill).isDirectory());
  strictEqual(readFileSync(join(skill, "SKILL.md"), "utf8"), "copied skill\n");
  ok(!existsSync(join(cli, ".skills-fedify-cli-symlink")));
});
