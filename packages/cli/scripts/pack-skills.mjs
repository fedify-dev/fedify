// Materializes the skill for npm pack, then restores its checkout representation.
// Git may check out a symlink as a text file when core.symlinks is false.
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const skillsPath = join(root, "..", "skills", "fedify-cli");
const tempPath = `${skillsPath}.tmp`;
const sentinel = join(root, "..", ".skills-fedify-cli-symlink");

function restore() {
  const saved = readFileSync(sentinel, "utf8");
  // Versions before the representation was recorded used an empty sentinel.
  const original = saved === ""
    ? {
      type: "symlink",
      target: "../../../claude-plugin/skills/fedify-cli",
    }
    : JSON.parse(saved);
  rmSync(skillsPath, { recursive: true, force: true });
  if (original.type === "file") {
    writeFileSync(skillsPath, Buffer.from(original.contents, "base64"), {
      mode: original.mode,
    });
  } else {
    // Junctions do not require Windows symlink privileges and need an absolute
    // target. On other systems retain the original link text.
    symlinkSync(
      process.platform === "win32"
        ? resolve(dirname(skillsPath), original.target)
        : original.target,
      skillsPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  rmSync(tempPath, { recursive: true, force: true });
  unlinkSync(sentinel);
}

const [cmd] = process.argv.slice(2);

if (cmd === "pre") {
  // Recover both an interrupted replacement and a completed prepack whose
  // postpack never ran, then copy the latest canonical source.
  if (existsSync(sentinel)) restore();

  const stat = lstatSync(skillsPath);
  if (!stat.isDirectory()) {
    let original;
    let target;
    if (stat.isSymbolicLink()) {
      original = { type: "symlink", target: readlinkSync(skillsPath) };
      target = realpathSync(skillsPath);
    } else if (stat.isFile()) {
      const contents = readFileSync(skillsPath);
      original = {
        type: "file",
        contents: contents.toString("base64"),
        mode: stat.mode,
      };
      target = realpathSync(
        resolve(dirname(skillsPath), contents.toString("utf8").trim()),
      );
    } else {
      throw new Error(
        "skills/fedify-cli is not a link, link text, or directory",
      );
    }
    if (!lstatSync(target).isDirectory()) {
      throw new Error("skills/fedify-cli does not point to a directory");
    }
    rmSync(tempPath, { recursive: true, force: true });
    cpSync(target, tempPath, { recursive: true });
    // Persist recovery data before replacing the original entry. An interrupted
    // copy leaves the original untouched; every later step can be recovered.
    writeFileSync(sentinel, JSON.stringify(original));
    rmSync(skillsPath, { recursive: true, force: true });
    renameSync(tempPath, skillsPath);
  }
} else if (cmd === "post") {
  if (existsSync(sentinel)) restore();
}
