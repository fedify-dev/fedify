import { ok, strictEqual } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const repo = fileURLToPath(new URL("../", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "fedify-testing-pack-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    !/^npm_config_/i.test(key) && key !== "NODE_PATH" && key !== "NODE_ENV"
  ),
);
function run(command, args, cwd = root) {
  try {
    return execFileSync(command, args, { cwd, env, encoding: "utf8" });
  } catch (error) {
    process.stderr.write(error.stdout ?? "");
    process.stderr.write(error.stderr ?? "");
    throw error;
  }
}
function packedManifest(path) {
  const tar = gunzipSync(readFileSync(path));
  for (let offset = 0; offset < tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().split("\0")[0];
    const size = parseInt(
      tar.subarray(offset + 124, offset + 136).toString().replace(/\0/g, ""),
      8,
    );
    if (!name) break;
    if (name === "package/package.json") {
      return JSON.parse(tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Packed package.json not found");
}

try {
  // Build first (the mise task does this). Skip prepack here so packing each
  // package does not repeatedly build the same dependency graph.
  const tarballs = {};
  for (
    const name of [
      "testing",
      "fedify",
      "vocab",
      "vocab-runtime",
      "vocab-tools",
      "webfinger",
    ]
  ) {
    const tarball = join(root, `${name}.tgz`);
    run(
      "pnpm",
      ["--config.ignore-scripts=true", "pack", "--out", tarball],
      join(repo, "packages", name),
    );
    tarballs[`@fedify/${name}`] = `file:${tarball}`;
  }
  const metadata = packedManifest(join(root, "testing.tgz"));
  strictEqual(metadata.dependencies["@fedify/vocab"], `^${metadata.version}`);
  const deno = JSON.parse(readFileSync(join(repo, "deno.json"), "utf8"));
  strictEqual(
    metadata.dependencies["@js-temporal/polyfill"],
    deno.imports["@js-temporal/polyfill"].replace(
      "npm:@js-temporal/polyfill@",
      "",
    ),
  );
  ok(!("@fedify/fixture" in metadata.dependencies));
  ok("@fedify/fixture" in metadata.devDependencies);

  const consumer = join(root, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { "@fedify/fedify": tarballs["@fedify/fedify"] },
      devDependencies: { "@fedify/testing": tarballs["@fedify/testing"] },
      pnpm: { overrides: tarballs },
    }),
  );
  writeFileSync(
    join(consumer, ".npmrc"),
    [
      "node-linker=isolated",
      "modules-dir=node_modules",
      "virtual-store-dir=node_modules/.pnpm",
      "hoist=false",
      "public-hoist-pattern[]=",
      "shamefully-hoist=false",
      "auto-install-peers=false",
      "enable-global-virtual-store=false",
      "strict-peer-dependencies=true",
    ].join("\n") + "\n",
  );
  run(
    "pnpm",
    ["install", "--ignore-scripts", "--no-frozen-lockfile"],
    consumer,
  );
  ok(!existsSync(join(consumer, "node_modules/.pnpm/node_modules")));
  for (const dependency of ["@fedify/vocab", "@js-temporal/polyfill"]) {
    ok(!existsSync(join(consumer, "node_modules", dependency)));
  }
  const consumerReal = realpathSync(consumer);
  const require = createRequire(join(consumer, "package.json"));
  const testing = realpathSync(require.resolve("@fedify/testing/package.json"));
  for (const dependency of ["@fedify/vocab", "@js-temporal/polyfill"]) {
    // Require a direct package-local link, not a transitive or hoisted fallback.
    const target = realpathSync(resolve(testing, "../../..", dependency));
    ok(target.startsWith(consumerReal + sep));
  }

  const smoke = `
const federation = createFederation();
const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const keyId = new URL("https://example.com/users/alice#main-key");
federation.setActorDispatcher("/users/{identifier}", () => null)
  .setKeyPairsDispatcher(() => [{ ...keys, keyId }]);
const context = federation.createContext(new URL("https://example.com/"), "data");
assert.equal(context.data, "data");
const wrapped = await context.getActorKeyPairs("alice");
assert.equal(wrapped.length, 1);
assert.equal(wrapped[0].cryptographicKey.id.href, keyId.href);
assert.equal(wrapped[0].cryptographicKey.ownerId.href, context.getActorUri("alice").href);
assert.equal(wrapped[0].multikey.id.href, keyId.href);
assert.equal(wrapped[0].multikey.controllerId.href, context.getActorUri("alice").href);
`;
  writeFileSync(
    join(consumer, "smoke.mjs"),
    'import assert from "node:assert/strict";\n' +
      'import { createFederation } from "@fedify/testing";\n' + smoke,
  );
  writeFileSync(
    join(consumer, "smoke.cjs"),
    'const assert = require("node:assert/strict");\n' +
      'const { createFederation } = require("@fedify/testing");\n' +
      `(async () => {${smoke}})().catch(error => { console.error(error); process.exitCode = 1; });\n`,
  );
  for (const runtime of ["node", "bun"]) {
    for (const format of ["mjs", "cjs"]) {
      run(runtime, [`smoke.${format}`], consumer);
      console.log(
        `${runtime} ${format}: isolated @fedify/testing tarball passed`,
      );
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
