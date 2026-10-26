// Resolves the skills/fedify-cli symlink to real files before npm pack, and
// restores the symlink afterwards.  Only acts when the path is a symlink;
// a real directory is left untouched in both directions.
import {
  cpSync,
  existsSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const skillsPath = join(root, "..", "skills", "fedify-cli");
const sentinel = join(root, "..", ".skills-fedify-cli-symlink");

const [cmd] = process.argv.slice(2);

if (cmd === "pre") {
  // If a previous pack run was interrupted after prepack but before postpack,
  // skillsPath is a real directory and the sentinel still exists.  Restore
  // the symlink first so the conversion below can run cleanly and pick up
  // any source changes that happened in the interim.
  if (existsSync(sentinel)) {
    rmSync(skillsPath, { recursive: true, force: true });
    symlinkSync("../../../claude-plugin/skills/fedify-cli", skillsPath, "dir");
    unlinkSync(sentinel);
  }

  const stat = lstatSync(skillsPath);
  if (stat.isSymbolicLink()) {
    const target = realpathSync(skillsPath);
    const tempPath = `${skillsPath}.tmp`;
    rmSync(tempPath, { recursive: true, force: true });
    cpSync(target, tempPath, { recursive: true });
    unlinkSync(skillsPath);
    renameSync(tempPath, skillsPath);
    writeFileSync(sentinel, "");
  } else if (!stat.isDirectory()) {
    throw new Error(
      `skills/fedify-cli is neither a symlink nor a directory (got mode ${
        stat.mode.toString(8)
      }). ` +
        "On Windows, check core.symlinks in git config.",
    );
  }
} else if (cmd === "post") {
  if (existsSync(sentinel)) {
    rmSync(skillsPath, { recursive: true, force: true });
    symlinkSync("../../../claude-plugin/skills/fedify-cli", skillsPath, "dir");
    unlinkSync(sentinel);
  }
}
