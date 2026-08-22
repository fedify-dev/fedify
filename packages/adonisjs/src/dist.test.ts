/**
 * Guards the built artifacts, not the sources.
 *
 * The CommonJS half of the dual build only works because `require()` of an ESM
 * graph is supported on this package's Node.js range (>= 24) **and** no module
 * here uses top-level await.  Both halves of that condition are silent — a
 * top-level `await` would build fine and only fail at `require()` time — so
 * this suite loads every published entry through the exports map in both
 * module systems.
 *
 * The suite skips itself when `dist/` has not been built; run `npm run build`
 * first for full coverage.
 *
 * @module
 */
import { ok, strictEqual } from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);

const distBuilt = existsSync(new URL("../dist/index.cjs", import.meta.url));

/**
 * Every subpath the exports map advertises, as bare specifiers so the exports
 * map itself is what resolves them.
 */
const ENTRIES = [
  "@fedify/adonisjs",
  "@fedify/adonisjs/types",
  "@fedify/adonisjs/provider",
  "@fedify/adonisjs/middleware",
  "@fedify/adonisjs/services/builder",
];

describe("built package", { skip: !distBuilt && "dist/ is not built" }, () => {
  it("loads every entry from CommonJS", () => {
    for (const entry of ENTRIES) {
      // Throws ERR_REQUIRE_ESM if top-level await ever creeps into the graph.
      require(entry);
    }
  });

  it("loads every entry from ESM", async () => {
    for (const entry of ENTRIES) {
      await import(entry);
    }
  });

  it("exposes a usable main function in both module systems", async () => {
    const cjs = require("@fedify/adonisjs");
    const esm = await import("@fedify/adonisjs");

    for (const m of [cjs, esm]) {
      strictEqual(typeof m.fedifyMiddleware, "function");
      strictEqual(typeof m.defineConfig, "function");
      strictEqual(typeof m.configure, "function");
    }

    // The default export is the main function, per the integration guide.
    strictEqual(esm.default, esm.fedifyMiddleware);
    ok(new URL(cjs.stubsRoot, "file://").pathname.length > 0);
  });
});
