import assert from "node:assert/strict";
import test from "node:test";
import { probeBenchmarkMode } from "./probe.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const STATS = {
  version: 1,
  source: "server",
  generatedAt: "2026-06-04T00:00:00Z",
  scopeMetrics: [
    { scope: { name: "@fedify/fedify", version: "2.3.0" }, metrics: [] },
  ],
  errors: [],
};

test("probeBenchmarkMode - detects benchmark mode and Fedify version", async () => {
  const probe = await probeBenchmarkMode(
    new URL("http://localhost:3000"),
    () => Promise.resolve(jsonResponse(STATS)),
  );
  assert.deepEqual(probe, { benchmarkMode: true, fedifyVersion: "2.3.0" });
});

test("probeBenchmarkMode - a 404 means no benchmark mode", async () => {
  const probe = await probeBenchmarkMode(
    new URL("http://localhost:3000"),
    () => Promise.resolve(jsonResponse({ error: "not found" }, 404)),
  );
  assert.deepEqual(probe, { benchmarkMode: false, fedifyVersion: null });
});

test("probeBenchmarkMode - a non-benchmark body means no benchmark mode", async () => {
  const probe = await probeBenchmarkMode(
    new URL("http://localhost:3000"),
    () => Promise.resolve(jsonResponse({ hello: "world" })),
  );
  assert.strictEqual(probe.benchmarkMode, false);
});

test("probeBenchmarkMode - a network error means no benchmark mode", async () => {
  const probe = await probeBenchmarkMode(
    new URL("http://localhost:3000"),
    () => Promise.reject(new Error("ECONNREFUSED")),
  );
  assert.deepEqual(probe, { benchmarkMode: false, fedifyVersion: null });
});
