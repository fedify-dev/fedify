import { isNil } from "@fxts/core";
import * as tsParser from "@typescript-eslint/parser";
import { Linter, type Rule } from "eslint";
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
      "Should not report issues when id property is present but found:",
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

function testEslint(
  {
    code,
    rule,
    ruleName,
    federationSetup = FEDERATION_SETUP,
    expectedError,
  }: {
    code: string;
    rule: Rule.RuleModule;
    ruleName: string;
    federationSetup?: string;
    expectedError?: string;
  },
) {
  const linter = new Linter({ configType: "flat" });

  const config = [{
    files: ["**/*.ts"],
    plugins: {
      "fedify-test": {
        rules: { [ruleName]: rule },
      },
    },
    rules: {
      [`fedify-test/${ruleName}`]: expectedError ? "error" : "off",
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
  } as Linter.Config];

  const fullCode = `${federationSetup ?? federationSetup}\n\n${code}`;
  const results = linter.verify(fullCode, config, `${ruleName}.test.ts`);

  if (isNil(expectedError)) {
    assert.equal(
      results.length,
      0,
      `Should not report issues but found: ${
        results.map((r) => r.message).join(", ")
      }`,
    );
  } else {
    assert.ok(
      results.length > 0,
      "Expected at least one diagnostic error but found none",
    );
    const matched = results.some((r) =>
      r.message.includes(expectedError) ||
      r.ruleId === `fedify-test/${ruleName}`
    );
    assert.ok(
      matched,
      `Expected fedify-test/${ruleName} to report but it did not. Got: ${
        results.map((r) => r.message).join(", ")
      }`,
    );
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
      eslint: Rule.RuleModule;
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
      testEslint({
        code,
        rule: eslint,
        ruleName,
        federationSetup,
        expectedError,
      });
  }
}
