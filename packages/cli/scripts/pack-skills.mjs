// Materializes the skill for npm pack, then restores its checkout representation.
// Git may check out a symlink as a text file when core.symlinks is false.
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
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
const sentinelTemp = `${sentinel}.tmp`;
// Keep the saved entry outside skills/, which is included in the npm package.
const originalPath = join(root, "..", ".skills-fedify-cli-original");

function entryStat(path) {
  try {
    // A parked relative symlink can dangle, so existsSync() is insufficient.
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function restore() {
  const saved = readFileSync(sentinel, "utf8");
  // Versions before the representation was recorded used an empty sentinel.
  const original =
    saved === ""
      ? {
          type: "symlink",
          target: "../../../claude-plugin/skills/fedify-cli",
        }
      : JSON.parse(saved);
  if (!["saved-entry", "symlink", "file"].includes(original?.type)) {
    throw new Error("unrecognized skills/fedify-cli recovery sentinel");
  }
  const backup = entryStat(originalPath);
  if (original.type === "saved-entry") {
    if (backup) {
      if (!backup.isSymbolicLink() && !backup.isFile()) {
        throw new Error("saved skills/fedify-cli entry is not a link or file");
      }
      rmSync(skillsPath, { recursive: true, force: true });
      renameSync(originalPath, skillsPath);
    } else {
      // The interruption preceded the backup rename, or restoration already
      // renamed it back. Never discard a materialized directory in this state.
      const current = entryStat(skillsPath);
      if (!current || (!current.isSymbolicLink() && !current.isFile())) {
        throw new Error("saved skills/fedify-cli entry is missing");
      }
    }
  } else {
    if (backup) {
      throw new Error("saved skills/fedify-cli entry has no matching sentinel");
    }
    rmSync(skillsPath, { recursive: true, force: true });
    if (original.type === "file") {
      writeFileSync(skillsPath, Buffer.from(original.contents, "base64"), {
        mode: original.mode,
      });
    } else {
      // Legacy records did not distinguish Windows symlinks from junctions.
      symlinkSync(
        process.platform === "win32"
          ? resolve(dirname(skillsPath), original.target)
          : original.target,
        skillsPath,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  }
  rmSync(tempPath, { recursive: true, force: true });
  rmSync(sentinelTemp, { force: true });
  unlinkSync(sentinel);
}

const [cmd] = process.argv.slice(2);

if (cmd === "pre") {
  // Recover both an interrupted replacement and a completed prepack whose
  // postpack never ran, then copy the latest canonical source.
  if (existsSync(sentinel)) restore();
  if (entryStat(originalPath)) {
    throw new Error("saved skills/fedify-cli entry has no matching sentinel");
  }

  const stat = lstatSync(skillsPath);
  if (!stat.isDirectory()) {
    let target;
    if (stat.isSymbolicLink()) {
      target = realpathSync(skillsPath);
    } else if (stat.isFile()) {
      const contents = readFileSync(skillsPath);
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
    // Publish complete recovery metadata before moving the original entry.
    writeFileSync(sentinelTemp, JSON.stringify({ type: "saved-entry" }));
    renameSync(sentinelTemp, sentinel);
    // Renaming preserves relative/absolute symlinks, junctions, and file bytes
    // without recreating links or requiring Windows symlink privileges.
    renameSync(skillsPath, originalPath);
    renameSync(tempPath, skillsPath);
  }
} else if (cmd === "post") {
  if (existsSync(sentinel)) restore();
}
