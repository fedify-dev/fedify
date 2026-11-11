// Exercise the publisher's lifecycle hooks as well as the tarball contents.
import assert from "node:assert/strict";
import spawn from "cross-spawn";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "fedify-npm-lifecycle-"));
function run(command, args, inherit = false) {
  const result = spawn.sync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: inherit ? "inherit" : "pipe",
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stderr ?? ""}`,
  );
  return result.stdout ?? "";
}
function representation(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    return {
      type: "link",
      target:
        process.platform === "win32" ? realpathSync(path) : readlinkSync(path),
    };
  }
  if (stat.isFile()) {
    return {
      type: "file",
      contents: readFileSync(path).toString("base64"),
      mode: stat.mode,
    };
  }
  assert.ok(stat.isDirectory(), `unexpected skill representation: ${path}`);
  return { type: "directory" };
}
const skills = [
  ["cli", "fedify-cli"],
  ["fedify", "fedify"],
].map(([pkg, name]) => {
  const path = join(root, "packages", pkg, "skills", name);
  return { pkg, name, path, before: representation(path) };
});
const status = run("git", [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
]);
let passed = false;
try {
  // Match main.yaml and publish-pr.yaml; shared dependency builds must be serial.
  run(
    "pnpm",
    [
      "pack",
      "--recursive",
      "--workspace-concurrency=1",
      "--filter=!./examples/**",
      "--config.enable-pre-post-scripts=true",
      "--pack-destination",
      scratch,
    ],
    true,
  );
  for (const { pkg, name, path, before } of skills) {
    const manifest = JSON.parse(
      readFileSync(join(root, "packages", pkg, "package.json"), "utf8"),
    );
    const archive = join(
      scratch,
      `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`,
    );
    const contents = run("tar", [
      "-xOf",
      archive,
      `package/skills/${name}/SKILL.md`,
    ]);
    assert.ok(
      contents.trim().length > 0,
      `${pkg}: skill was not materialized in tarball`,
    );
    assert.deepEqual(
      representation(path),
      before,
      `${pkg}: skill checkout was not restored`,
    );
    assert.equal(
      existsSync(join(root, "packages", pkg, `.skills-${name}-symlink`)),
      false,
    );
  }
  assert.equal(
    run("git", ["status", "--porcelain=v1", "--untracked-files=all"]),
    status,
    "npm packing changed the checkout",
  );
  passed = true;
  console.log(
    "Lifecycle-enabled npm packing preserved skills and the checkout.",
  );
} finally {
  if (passed) rmSync(scratch, { recursive: true, force: true });
  else console.error(`Retained npm packing artifacts: ${scratch}`);
}
