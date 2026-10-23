import { test } from "@fedify/fixture";
import { assert } from "@std/assert";
import metadata from "../package.json" with { type: "json" };

for (const dependency of ["@fedify/vocab", "@js-temporal/polyfill"]) {
  test(`package declares ${dependency} as a runtime dependency`, () => {
    assert(dependency in metadata.dependencies);
    assert(!(dependency in metadata.devDependencies));
  });
}

test("package keeps the test fixture as a development dependency", () => {
  assert("@fedify/fixture" in metadata.devDependencies);
  assert(!("@fedify/fixture" in metadata.dependencies));
});
