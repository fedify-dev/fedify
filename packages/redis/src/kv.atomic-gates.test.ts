// Run isolated profiles sequentially to keep child runtimes bounded.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const variables = [
  "REDIS_URL",
  "REDIS_CLUSTER_NODES",
  "REDIS_ATOMIC_ADMIN_URL",
  "REDIS_ATOMIC_CLUSTER_ADMIN_NODES",
  "REDIS_ATOMIC_MIGRATION_NODES",
];

test("Redis atomic fixture opt-ins reject absent and blank configuration before client startup", () => {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "fedify-redis-fixture-gates-"));
  const probe = join(directory, "guard.test.js");
  const files = [
    "kv.atomic.test.ts",
    "kv.atomic-admin.test.ts",
    "kv.atomic-cluster.test.ts",
  ].map((file) => pathToFileURL(join(packageRoot, "src", file)).href);
  // The child intercepts eager constructor startup and socket connections.
  // A regressed opt-in fails before it can reach a real default server.
  const source = `
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import net from "node:net";
import process from "node:process";
import { test } from "node:test";
// These probes intentionally test missing fixtures, not CI conformance.
delete process.env.FEDIFY_REDIS_REQUIRE_ATOMIC_TESTS;
assert.equal(process.env.FEDIFY_REDIS_REQUIRE_ATOMIC_TESTS, undefined);
const rawProfile = process.env.FEDIFY_REDIS_FIXTURE_PROFILE;
assert.notEqual(rawProfile, undefined, "fixture profile must reach the child");
const profile = JSON.parse(rawProfile);
// Deno's spawnSync inherits omitted env keys: clear them inside the child too.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("REDIS_")) delete process.env[key];
}
for (const key of ${JSON.stringify(variables)}) {
  if (profile.present) process.env[key] = profile.value;
  assert.equal(process.env[key], profile.present ? profile.value : undefined);
}
console.log("FIXTURE_PROFILE_HEX " + Buffer.from(JSON.stringify(profile)).toString("hex"));
const require = createRequire(${JSON.stringify(join(packageRoot, "package.json"))});
const { Redis, Cluster } = require("ioredis");
const calls = { redis: 0, cluster: 0, sockets: 0 };
Redis.prototype.connect = function () {
  calls.redis++;
  throw new Error("GUARD: unexpected Redis construction/startup");
};
Cluster.prototype.connect = function () {
  calls.cluster++;
  throw new Error("GUARD: unexpected Cluster construction/startup");
};
net.Socket.prototype.connect = function () {
  calls.sockets++;
  throw new Error("GUARD: unexpected socket connection");
};
for (const file of ${JSON.stringify(files)}) await import(file);
test("fixture guard records no client startup or socket connection", () => {
  assert.deepEqual(calls, { redis: 0, cluster: 0, sockets: 0 });
  console.log("FIXTURE_GUARD_OK");
});
`;
  writeFileSync(join(directory, "package.json"), '{"type":"module"}\n');
  writeFileSync(probe, source);
  let passed = false;
  try {
    for (const value of [undefined, "", " \t "]) {
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith("REDIS_")) delete env[key];
      }
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_OPTIONS;
      delete env.NODE_V8_COVERAGE;
      const profile = JSON.stringify({
        present: value !== undefined,
        value: value ?? "",
      });
      env.FEDIFY_REDIS_FIXTURE_PROFILE = profile;
      if (value !== undefined) {
        for (const key of variables) env[key] = value;
      }
      const args =
        process.versions.bun != null
          ? ["test", "--timeout=10000", probe]
          : process.versions.deno != null
            ? [
                "test",
                "--no-check",
                "--allow-read",
                "--allow-env",
                "--allow-sys",
                probe,
              ]
            : ["--experimental-transform-types", "--test", probe];
      const result = spawnSync(process.execPath, args, {
        cwd: resolve(packageRoot, "../.."),
        env,
        encoding: "utf8",
        timeout: 15_000,
      });
      const detail = `Fixture ${JSON.stringify(value)}; probe retained at ${directory}\n${result.stdout}${result.stderr}`;
      assert.ifError(result.error);
      assert.equal(result.status, 0, detail);
      assert.match(result.stdout + result.stderr, /FIXTURE_GUARD_OK/, detail);
      assert(
        (result.stdout + result.stderr).includes(
          `FIXTURE_PROFILE_HEX ${Buffer.from(profile).toString("hex")}`,
        ),
        detail,
      );
    }
    passed = true;
  } finally {
    if (passed) rmSync(directory, { recursive: true, force: true });
  }
});
