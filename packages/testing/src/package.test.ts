import { test } from "@fedify/fixture";
import { ok } from "node:assert/strict";
import metadata from "../package.json" with { type: "json" };

for (const dependency of ["@fedify/vocab", "temporal-polyfill"]) {
  test(`package declares ${dependency} as a runtime dependency`, () => {
    ok(dependency in metadata.dependencies);
    ok(!(dependency in metadata.devDependencies));
  });
}

test("package keeps the test fixture as a development dependency", () => {
  ok("@fedify/fixture" in metadata.devDependencies);
  ok(!("@fedify/fixture" in metadata.dependencies));
});
