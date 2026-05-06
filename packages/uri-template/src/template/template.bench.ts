import { test } from "@fedify/fixture";
import { createTemplatePairTest, pairTestSuites } from "../tests/mod.ts";
import Template from "./template.ts";

Deno.bench("Template", (b) => {
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
