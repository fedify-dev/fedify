import { Miniflare, Response } from "miniflare";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { styleText } from "node:util";

const selfTest = process.argv[2] === "--selftest";
const filters = process.argv.slice(selfTest ? 3 : 2).map((f) =>
  f.toLowerCase()
);

const scriptPath = join(import.meta.dirname ?? ".", "server.js");
const mf = new Miniflare({
  // @ts-ignore: scriptPath is not recognized in the type definitions
  scriptPath,
  modules: [
    { type: "ESModule", path: scriptPath },
  ],
  kvNamespaces: ["KV1", "KV2", "KV3"],
  queueProducers: ["Q1"],
  queueConsumers: { Q1: { maxBatchSize: 1 } },
  async outboundService(request: Request) {
    const url = new URL(request.url);
    if (url.hostname.endsWith(".test")) {
      const host = url.hostname.slice(0, -5);
      try {
        const document = JSON.parse(
          await readFile(
            new URL(
              "../../../fixture/src/fixtures/" + host + url.pathname + ".json",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        return new Response(JSON.stringify(document), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      } catch (e) {
        return new Response(String(e), { status: 404 });
      }
    }
    throw new Error(`Unexpected outbound request: ${request.method} ${url}`);
  },
  compatibilityDate: "2025-05-23",
  compatibilityFlags: ["nodejs_compat"],
});
try {
  const url = await mf.ready;
  if (selfTest) {
    url.searchParams.set("selftest", "");
  }
  const response = await mf.dispatchFetch(url);
  const tests = await response.json() as string[];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const test of tests) {
    const testLower = test.toLowerCase();
    if (filters.length > 0 && !filters.some((f) => testLower.includes(f))) {
      continue;
    }
    const resp = await mf.dispatchFetch(url, {
      method: "POST",
      body: test,
      headers: { "Content-Type": "text/plain" },
    });
    if (resp.ok) {
      console.log(styleText("green", `PASS: ${test}`));
      passed++;
    } else if (resp.status === 404) {
      console.log(styleText("yellow", `SKIP: ${test}`));
      skipped++;
    } else {
      const text = await resp.text();
      console.log(styleText("red", `FAIL: ${test}`));
      console.log(text);
      failed++;
    }
  }
  console.log(
    `Tests completed: ${styleText("green", `${passed} passed`)}, ${
      styleText("red", `${failed} failed`)
    }, ${styleText("yellow", `${skipped} skipped`)}.`,
  );

  if (failed > 0) process.exitCode = 1;
} finally {
  await mf.dispose();
}

// cSpell: ignore Miniflare
