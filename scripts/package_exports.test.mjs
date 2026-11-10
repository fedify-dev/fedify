import { doesNotThrow, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkExports } from "./package_exports.mjs";

function withBuild(run) {
  const root = mkdtempSync(join(tmpdir(), "fedify-export-check-"));
  mkdirSync(join(root, "dist"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("rejects runtime and declaration targets missing from the build", () => {
  withBuild((root) => {
    for (const target of ["dist/mod.js", "dist/mod.d.ts"]) {
      throws(
        () =>
          checkExports("@fedify/example", [], { exports: `./${target}` }, root),
        { message: `@fedify/example: export missing from build: ${target}` },
      );
    }
  });
});

test("requires built exports to be included in the tarball", () => {
  withBuild((root) => {
    writeFileSync(join(root, "dist/mod.js"), "export {};\n");
    const manifest = { exports: { ".": { import: "./dist/mod.js" } } };
    throws(() => checkExports("@fedify/example", [], manifest, root), {
      message: "@fedify/example: missing export dist/mod.js",
    });
    doesNotThrow(() =>
      checkExports("@fedify/example", ["dist/mod.js"], manifest, root),
    );
  });
});

test("limits existing build exceptions to the exact NestJS paths", (t) => {
  t.mock.method(console, "warn", () => {});
  withBuild((root) => {
    const manifest = {
      exports: {
        ".": {
          require: {
            types: "./dist/index.d.ts",
            default: "./dist/index.js",
          },
        },
      },
    };
    doesNotThrow(() => checkExports("@fedify/nestjs", [], manifest, root));
    throws(() => checkExports("@fedify/other", [], manifest, root));
    throws(() =>
      checkExports("@fedify/nestjs", [], { exports: "./dist/other.js" }, root),
    );
    // Existing build exceptions do not apply to the JSR file-list check.
    throws(() => checkExports("@fedify/nestjs", [], manifest));
  });
});

test("checks previously missing NestJS paths once they are built", () => {
  withBuild((root) => {
    writeFileSync(join(root, "dist/index.js"), "export {};\n");
    throws(
      () =>
        checkExports(
          "@fedify/nestjs",
          [],
          { exports: "./dist/index.js" },
          root,
        ),
      { message: "@fedify/nestjs: missing export dist/index.js" },
    );
  });
});

test("checks string and named binary targets", () => {
  for (const bin of ["./dist/cli.js", { cli: "./dist/cli.js" }]) {
    throws(() => checkExports("@fedify/example", [], { bin }), {
      message: "@fedify/example: missing binary ./dist/cli.js",
    });
    doesNotThrow(() =>
      checkExports("@fedify/example", ["dist/cli.js"], { bin }),
    );
  }
});
