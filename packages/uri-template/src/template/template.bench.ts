import { test } from "@fedify/fixture";
import { createTemplatePairTest, pairTestSuites } from "../tests/mod.ts";
import Template from "./mod.ts";

Deno.bench("Template using RegExp", (b) => {
  const runPairCases = createTemplatePairTest(Template);
  b.start();
  for (const _ of Array(10000)) {
    for (const { name, cases } of pairTestSuites) {
      test(
        name,
        runPairCases(cases as unknown as readonly [string, string][]),
      );
    }
  }
  b.end();
});
