import { isNil } from "@fxts/core";
import { assert, assertEquals, assertGreater } from "jsr:@std/assert";
import { FEDERATION_SETUP } from "./const.ts";

const LINT_PLUGIN_NAME = "fedify-lint-test";

export function testDenoLint(
  {
    code,
    rule,
    ruleName,
    federationSetup = FEDERATION_SETUP,
    expectedError,
  }: {
    code: string;
    rule: Deno.lint.Rule;
    ruleName: string;
    federationSetup?: string | false;
    expectedError?: string;
  },
) {
  const plugin: Deno.lint.Plugin = {
    name: LINT_PLUGIN_NAME,
    rules: { [ruleName]: rule },
  };

  const diagnostics = Deno.lint.runPlugin(
    plugin,
    ruleName + ".test.ts",
    `${federationSetup ? federationSetup : ""}\n\n${code}`,
  );

  if (isNil(expectedError)) {
    assertEquals(
      diagnostics.length,
      0,
      "Should not report issues when id property is present",
    );
  } else {
    assertGreater(
      diagnostics.length,
      0,
      "Expected at least one diagnostic error but found none",
    );
    const lintId = `${LINT_PLUGIN_NAME}/${ruleName}`;
    const matched = diagnostics.some((diag) =>
      diag.message.includes(expectedError)
    );
    assert(
      matched,
      `Expected ${lintId} to report but it did not.`,
    );
  }
}
