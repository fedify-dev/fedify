import { isNil } from "@fxts/core";
import { RuleTester } from "@typescript-eslint/rule-tester";
import type { TSESLint } from "@typescript-eslint/utils";
import assert from "node:assert/strict";
import { FEDERATION_SETUP } from "./const.ts";

const LINT_PLUGIN_NAME = "fedify-lint-test";

function testDenoLint(
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
    federationSetup?: string;
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
    `${federationSetup ?? federationSetup}\n\n${code}`,
  );

  if (isNil(expectedError)) {
    assert.equal(
      diagnostics.length,
      0,
      `Should not report issues when id property is present but found: \n${
        diagnostics.map((d) => "  - " + d.message).join(", ")
      }

=== CODE ===
${code}
=======`,
    );
  } else {
    assert.ok(
      diagnostics.length > 0,
      "Expected at least one diagnostic error but found none",
    );
    const lintId = `${LINT_PLUGIN_NAME}/${ruleName}`;
    const matched = diagnostics.some((diag) =>
      diag.message.includes(expectedError)
    );
    assert.ok(
      matched,
      `Expected ${lintId} to report but it did not.`,
    );
  }
}

RuleTester.afterAll = () => {};
RuleTester.describe = () => {};

function testEslintRule(
  {
    code,
    rule,
    ruleName,
    federationSetup = FEDERATION_SETUP,
    expectedError,
  }: {
    code: string;
    rule: TSESLint.RuleModule<string, unknown[]>;
    ruleName: string;
    federationSetup?: string;
    expectedError?: string;
  },
) {
  const ruleTester = new RuleTester({
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  });

  const fullCode = `${federationSetup ?? federationSetup}\n\n${code}`;

  if (isNil(expectedError)) {
    ruleTester.run(ruleName, rule, {
      valid: [fullCode],
      invalid: [],
    });
  } else {
    ruleTester.run(ruleName, rule, {
      valid: [],
      invalid: [
        {
          code: fullCode,
          errors: [{ messageId: expectedError }],
        },
      ],
    });
  }
}

export default function lintTest(
  {
    code,
    rule: { deno, eslint },
    ruleName,
    federationSetup = FEDERATION_SETUP,
    expectedError,
  }: {
    code: string;
    rule: {
      deno: Deno.lint.Rule;
      eslint: TSESLint.RuleModule<string, unknown[]>;
    };
    ruleName: string;
    federationSetup?: string;
    expectedError?: string;
  },
) {
  if ("Deno" in globalThis) {
    return () =>
      testDenoLint({
        code,
        rule: deno,
        ruleName,
        federationSetup,
        expectedError,
      });
  } else {
    return () =>
      testEslintRule({
        code,
        rule: eslint,
        ruleName,
        federationSetup,
        expectedError,
      });
  }
}
