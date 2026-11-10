import { deepStrictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { discoverTestImports } from "./discover_tests.ts";

async function withFixture(run: (baseDir: string) => Promise<void>) {
  const baseDir = await mkdtemp(join(tmpdir(), "fedify-workers-discovery-"));
  try {
    await run(baseDir);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

it("discovers only .test.js entries and sorts slash-separated imports", async () => {
  await withFixture(async (baseDir) => {
    // Create out of order, including hidden paths and a codegen-named subtree:
    // neither was excluded by the previous dist/**/*.test.js glob.
    const files = [
      "dist/z-last.test.js",
      "dist/src/codegen/retained.test.js",
      "dist/nested/z.test.js",
      "dist/nested/a.test.js",
      "dist/.hidden/inside.test.js",
      "dist/.hidden.test.js",
      "dist/space name.test.js",
      "dist/ignored.test.js.map",
      "dist/ignored.test.ts",
      "dist/ignored.js",
      "outside.test.js",
    ];
    for (const file of files) {
      const path = join(baseDir, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
    }
    await mkdir(join(baseDir, "dist", "directory.test.js"));
    deepStrictEqual(await discoverTestImports(baseDir), [
      'import "./dist/.hidden.test.js";',
      'import "./dist/.hidden/inside.test.js";',
      'import "./dist/nested/a.test.js";',
      'import "./dist/nested/z.test.js";',
      'import "./dist/space name.test.js";',
      'import "./dist/src/codegen/retained.test.js";',
      'import "./dist/z-last.test.js";',
    ]);
  });
});

it("does not follow directory links into additional tests or loops", async () => {
  await withFixture(async (baseDir) => {
    const dist = join(baseDir, "dist");
    const outside = join(baseDir, "outside");
    await mkdir(dist);
    await mkdir(outside);
    await writeFile(join(dist, "included.test.js"), "");
    await writeFile(join(outside, "excluded.test.js"), "");
    await symlink(outside, join(dist, "link"), "junction");
    await symlink(dist, join(dist, "loop"), "junction");
    deepStrictEqual(await discoverTestImports(baseDir), [
      'import "./dist/included.test.js";',
    ]);
  });
});

it("returns no imports for an absent or empty dist directory", async () => {
  await withFixture(async (baseDir) => {
    deepStrictEqual(await discoverTestImports(baseDir), []);
    await mkdir(join(baseDir, "dist"));
    deepStrictEqual(await discoverTestImports(baseDir), []);
  });
});

// The pure fixtures also run with the package's restricted Deno permissions.
// Only the Node-entry-point smoke test needs permission to spawn Node.
declare const Deno: {
  permissions: {
    query(options: {
      name: "run";
      command: string;
    }): Promise<{ state: string }>;
  };
};
const nodeSubprocessAllowed =
  !("Deno" in globalThis) ||
  (await Deno.permissions.query({ name: "run", command: "node" })).state ===
    "granted";

it(
  "Node entry point prints only imports independently of cwd",
  { skip: !nodeSubprocessAllowed },
  async () => {
    await withFixture(async (root) => {
      const scripts = join(root, "scripts");
      const dist = join(root, "src", "cfworkers", "dist");
      await mkdir(scripts);
      await mkdir(dist, { recursive: true });
      await writeFile(join(root, "package.json"), '{"type":"module"}');
      await writeFile(join(dist, "z.test.js"), "");
      await writeFile(join(dist, "a.test.js"), "");
      const script = join(scripts, "discover_tests.ts");
      await copyFile(new URL("./discover_tests.ts", import.meta.url), script);
      const result = spawnSync("node", ["--experimental-strip-types", script], {
        cwd: scripts,
        encoding: "utf8",
        timeout: 10_000,
      });
      if (result.error) throw result.error;
      deepStrictEqual(result.signal, null);
      deepStrictEqual(result.status, 0, result.stderr);
      deepStrictEqual(result.stderr, "");
      deepStrictEqual(
        result.stdout,
        'import "./dist/a.test.js";\nimport "./dist/z.test.js";\n',
      );
    });
  },
);
