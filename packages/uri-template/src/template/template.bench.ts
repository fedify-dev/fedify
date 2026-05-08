import { test } from "@fedify/fixture";
import { createTemplatePairTest, pairTestSuites } from "../tests/mod.ts";
import Template from "./template.ts";

Deno.bench("Template", (b) => {
  const runPairCases = createTemplatePairTest(Template);
  b.start();
  for (const _ of Array(10000)) {
    test("expand: examples", runPairCases(pairTestSuites));
  }
  b.end();
});
