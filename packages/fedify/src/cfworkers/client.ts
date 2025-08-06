import { Miniflare } from "miniflare";
import { join } from "node:path";
import process from "node:process";
import { styleText } from "node:util";

const filters = process.argv.slice(2).map((f) => f.toLowerCase());

const mf = new Miniflare({
  // @ts-ignore: scriptPath is not recognized in the type definitions
  scriptPath: join(import.meta.dirname ?? ".", "server.js"),
  modules: [
    { type: "ESModule", path: join(import.meta.dirname ?? ".", "server.js") },
  ],
  kvNamespaces: ["KV1", "KV2", "KV3"],
  queueProducers: ["Q1"],
  queueConsumers: { Q1: { maxBatchSize: 1 } },
  async outboundService(request: Request) {
    const url = new URL(request.url);
    if (url.hostname.endsWith(".test")) {
      const host = url.hostname.slice(0, -5);
      try {
        const { default: document } = await import(
          "../testing/fixtures/" + host + url.pathname + ".json"
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
    return await fetch(request);
  },
  compatibilityDate: "2025-05-23",
  compatibilityFlags: ["nodejs_compat"],
});
const url = await mf.ready;
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
await mf.dispose();
console.log(
  `Tests completed: ${styleText("green", `${passed} passed`)}, ${
    styleText("red", `${failed} failed`)
  }, ${styleText("yellow", `${skipped} skipped`)}.`,
);

// cSpell: ignore Miniflare
