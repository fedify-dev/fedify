import { strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isDirectoryEmpty,
  resolveRequiredVersion,
  verifyRuntimeVersion,
} from "./lib.ts";
import { runSubCommand } from "./utils.ts";

test("isDirectoryEmpty allows an unborn Git repository", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);

    strictEqual(await isDirectoryEmpty(dir), true);
  });
});

test("isDirectoryEmpty allows a freshly initialized Git repository", async (t) => {
  if (!await isGitAvailable()) {
    t.skip("git is not installed");
    return;
  }

  await withTempDir(async (dir) => {
    await runGit(dir, ["init"]);

    strictEqual(await isDirectoryEmpty(dir), true);
  });
});

test("isDirectoryEmpty rejects a Git repository with a branch ref", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await writeFile(
      join(dir, ".git", "refs", "heads", "main"),
      "0000000000000000000000000000000000000000\n",
    );

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a Git repository with another ref", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await mkdir(join(dir, ".git", "refs", "remotes", "origin"), {
      recursive: true,
    });
    await writeFile(
      join(dir, ".git", "refs", "remotes", "origin", "main"),
      "0000000000000000000000000000000000000000\n",
    );

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a Git repository with a HEAD commit", async (t) => {
  if (!await isGitAvailable()) {
    t.skip("git is not installed");
    return;
  }

  await withTempDir(async (dir) => {
    await runGit(dir, ["init"]);
    await runGit(dir, [
      "-c",
      "user.name=Fedify Test",
      "-c",
      "user.email=fedify@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "Initial commit",
    ]);

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a Git repository with a packed ref", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await writeFile(
      join(dir, ".git", "packed-refs"),
      "0000000000000000000000000000000000000000 refs/tags/v1.0.0\n",
    );

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a Git repository with stored objects", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await mkdir(join(dir, ".git", "objects", "01"), { recursive: true });
    await writeFile(join(dir, ".git", "objects", "01", "2345"), "object");

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a Git repository with an index", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await writeFile(join(dir, ".git", "index"), "");

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a Git repository with reflogs", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await mkdir(join(dir, ".git", "logs"), { recursive: true });
    await writeFile(join(dir, ".git", "logs", "HEAD"), "");

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a detached Git HEAD", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await writeFile(
      join(dir, ".git", "HEAD"),
      "0000000000000000000000000000000000000000\n",
    );

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects additional files beside .git", async () => {
  await withTempDir(async (dir) => {
    await createUnbornGitRepository(dir);
    await writeFile(join(dir, "package.json"), "{}\n");

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("isDirectoryEmpty rejects a .git file", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, ".git"), "gitdir: ../.git/worktrees/example\n");

    strictEqual(await isDirectoryEmpty(dir), false);
  });
});

test("verifyRuntimeVersion accepts equal versions", () => {
  strictEqual(verifyRuntimeVersion("2.0.0", "2.0.0"), true);
  strictEqual(verifyRuntimeVersion("2", "2.0.0"), true);
});

test("verifyRuntimeVersion accepts higher versions", () => {
  strictEqual(verifyRuntimeVersion("2.0.1", "2.0"), true);
  strictEqual(verifyRuntimeVersion("2.1.0", "2.0.0"), true);
  strictEqual(verifyRuntimeVersion("3.0.0", "2.0.0"), true);
});

test("verifyRuntimeVersion rejects lower versions", () => {
  strictEqual(verifyRuntimeVersion("1.9.9", "2.0.0"), false);
  strictEqual(verifyRuntimeVersion("2.0.1", "2.1.0"), false);
  strictEqual(verifyRuntimeVersion("2.0.0", "2.0.1"), false);
});

test("resolveRequiredVersion raises the base minimum for stricter frameworks", () => {
  strictEqual(resolveRequiredVersion("node", "22.12.0"), "22.12.0");
  strictEqual(resolveRequiredVersion("node", "21.0.0"), "22.0.0");
  strictEqual(resolveRequiredVersion("node", undefined), "22.0.0");
});

async function createUnbornGitRepository(dir: string): Promise<void> {
  await mkdir(join(dir, ".git", "objects"), { recursive: true });
  await mkdir(join(dir, ".git", "refs", "heads"), { recursive: true });
  await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
}

async function isGitAvailable(): Promise<boolean> {
  try {
    await runSubCommand(["git", "--version"], {});
    return true;
  } catch {
    return false;
  }
}

async function runGit(dir: string, args: string[]): Promise<void> {
  await runSubCommand(["git", "-C", dir, ...args], {});
}

async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fedify-init-dir-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
