/**
 * ESLint test utilities.
 * Uses @typescript-eslint/rule-tester for testing ESLint rules.
 */
import { RuleTester } from "@typescript-eslint/rule-tester";
import type { TSESLint } from "@typescript-eslint/utils";
import { FEDERATION_SETUP } from "./const.ts";

// Configure RuleTester to use node:test
RuleTester.afterAll = () => {};
RuleTester.it = (title, fn) => fn();
RuleTester.describe = (_, fn) => fn();

export type RuleModule = TSESLint.RuleModule<string, unknown[]>;

export interface ESLintTestCase {
  /** Test case name */
  name: string;
  /** Code to test */
  code: string;
}

export interface ESLintInvalidTestCase extends ESLintTestCase {
  /** Expected error message IDs */
  errors: Array<{ messageId: string }>;
}

/**
 * Creates a RuleTester instance for testing ESLint rules.
 */
export function createRuleTester(): RuleTester {
  return new RuleTester();
}

/**
 * Wraps code with federation setup for testing.
 */
export function wrapWithFederationSetup(
  code: string,
  federationSetup: string | false = FEDERATION_SETUP,
): string {
  if (federationSetup === false) return code;
  return `${federationSetup}\n\n${code}`;
}

/**
 * Creates valid test cases with federation setup.
 */
export function validCase(
  name: string,
  code: string,
  federationSetup: string | false = FEDERATION_SETUP,
): ESLintTestCase {
  return {
    name,
    code: wrapWithFederationSetup(code, federationSetup),
  };
}

/**
 * Creates invalid test cases with federation setup and expected errors.
 */
export function invalidCase(
  name: string,
  code: string,
  messageId: string,
  federationSetup: string | false = FEDERATION_SETUP,
): ESLintInvalidTestCase {
  return {
    name,
    code: wrapWithFederationSetup(code, federationSetup),
    errors: [{ messageId }],
  };
}

/**
 * Runs ESLint rule tests.
 */
export function runESLintTests(
  ruleName: string,
  rule: RuleModule,
  tests: {
    valid: ESLintTestCase[];
    invalid: ESLintInvalidTestCase[];
  },
): void {
  const tester = createRuleTester();
  tester.run(ruleName, rule, tests);
}
