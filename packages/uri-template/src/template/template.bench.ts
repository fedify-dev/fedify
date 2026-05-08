import { test } from "@fedify/fixture";
import {
  createMatchBench,
  createMatchBenchTestCases,
  createTemplatePairTest,
  pairTestSuites,
} from "../tests/mod.ts";
import Template from "./template.ts";

Deno.bench("Template (expand)", (b) => {
  const runPairCases = createTemplatePairTest(Template);
  b.start();
  for (const _ of Array(10000)) {
    test("expand: examples", runPairCases(pairTestSuites));
  }
  b.end();
});

const matchBench = createMatchBench(Template);
Deno.bench(
  "Template (match) — 5-var unnamed, 8 parts",
  (b) => {
    const bench = matchBench("/items/{a,b,c}/end");
    b.start();
    bench(Array(1000).fill("/items/p1,p2,p3,p4,p5,p6,p7,p8,p9,p0,p11,p12/end"));
    b.end();
  },
);

Deno.bench(
  "Template (match) — 728 paths test",
  (b) => {
    const bench = matchBench("{/paths*}");
    const cases = createMatchBenchTestCases();
    b.start();
    bench(cases);
    b.end();
  },
);
