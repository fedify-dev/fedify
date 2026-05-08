import { deepEqual, equal, ok, throws } from "node:assert/strict";
import * as ERROR_CLASSES from "../template/errors.ts";
import type { ExpandContext } from "../types.ts";
import testVars from "./json/references/vars.json" with { type: "json" };

interface TemplateConstructor {
  new (template: string): {
    expand(context: ExpandContext): string;
    match(uri: string): ExpandContext | null;
  };
}

type PairTestCase = readonly [template: string, expanded: string];

export interface PairTestSuite {
  name: string;
  cases: readonly PairTestCase[];
}

export function createTemplatePairTest(
  Template: TemplateConstructor,
): (
  suites: readonly PairTestSuite[],
  context?: ExpandContext,
) => (t: Deno.TestContext) => Promise<void> {
  return (
    suites: readonly PairTestSuite[],
    context: ExpandContext = testVars,
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { name, cases } of suites) {
      await t.step(name, async (t) => {
        for (const [template, expected] of cases) {
          await t.step(
            `${template} => ${expected}`,
            () => equal(new Template(template).expand(context), expected),
          );
        }
      });
    }
  };
}

export function createTemplateMatchTest(
  Template: TemplateConstructor,
): (
  suites: readonly PairTestSuite[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    suites: readonly PairTestSuite[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { name, cases } of suites) {
      await t.step(name, async (t) => {
        for (const [template, expanded] of cases) {
          await t.step(
            `${expanded} => ${template}`,
            () => {
              const instance = new Template(template);
              const matched = instance.match(expanded);
              ok(matched != null, `match returned null for ${expanded}`);
              equal(instance.expand(matched), expanded);
            },
          );
        }
      });
    }
  };
}

export interface MatchTestSuite {
  name: string;
  cases: readonly MatchTestCase[];
}

interface MatchTestCase {
  name: string;
  template: string;
  uri: string;
  expected: ExpandContext | null;
  reason?: string;
}

export function createMatchOnlyTest(
  Template: TemplateConstructor,
): (
  suites: readonly MatchTestSuite[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    suites: readonly MatchTestSuite[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { name, cases } of suites) {
      await t.step(name, async (t) => {
        for (const c of cases) {
          await t.step(c.name, () => {
            const got = new Template(c.template).match(c.uri);
            deepEqual(got, c.expected);
          });
        }
      });
    }
  };
}

export interface FixedTemplateTestSuite {
  name: string;
  template: string;
  cases: readonly FixedTemplateTestCase[];
}

interface FixedTemplateTestCase {
  name: string;
  context: ExpandContext;
  expected: string;
}

export const createFixedTemplateTest: (
  Template: TemplateConstructor,
) => (
  suites: readonly FixedTemplateTestSuite[],
) => (t: Deno.TestContext) => Promise<void> = (
  Template: TemplateConstructor,
) => {
  return (
    suites: readonly FixedTemplateTestSuite[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { template, name, cases } of suites) {
      await t.step(name, async (t) => {
        const instance = new Template(template);
        for (const { name, context, expected } of cases) {
          await t.step(name, () => equal(instance.expand(context), expected));
        }
      });
    }
  };
};

export const createFixedTemplateMatchTest: (
  Template: TemplateConstructor,
) => (
  suites: readonly FixedTemplateTestSuite[],
) => (t: Deno.TestContext) => Promise<void> = (
  Template: TemplateConstructor,
) => {
  return (
    suites: readonly FixedTemplateTestSuite[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { template, name, cases } of suites) {
      await t.step(name, async (t) => {
        const instance = new Template(template);
        for (const { name, expected } of cases) {
          await t.step(name, () => {
            const matched = instance.match(expected);
            ok(matched != null, `match returned null for ${expected}`);
            equal(instance.expand(matched), expected);
          });
        }
      });
    }
  };
};

type ErrorName = keyof typeof ERROR_CLASSES;

/**
 * A single negative test case asserting that a given URI template MUST cause
 * the parser to throw a specific error class.
 *
 * Unlike {@link PairTestSuite} or {@link FixedTemplateTestSuite}, which assert
 * successful expansion, a {@link WrongTemplateTestCase} pins down the exact
 * error class that the parser is expected to raise. Pinning the class — rather
 * than merely asserting "something throws" — catches regressions where the
 * parser still rejects the input but with a less precise diagnostic.
 */
interface WrongTemplateTestCase {
  /**
   * Human-readable label of the case, used as the test step name.
   * Should explain *why* the template is invalid (e.g.
   * "unclosed opening brace"), not what the error is.
   */
  name: string;
  /**
   * The URI template string that the parser MUST reject.
   */
  template: string;
  /**
   * The `name` of the error class that the parser MUST throw, taken from
   * the concrete classes exported by *src/template/errors.ts* (e.g.
   * `"UnclosedExpressionError"`, `"InvalidLiteralError"`).
   *
   * The runner compares the thrown error's `instanceof` against the class
   * resolved from this name; subclasses count as a match.
   */
  expected: ErrorName;
}

export interface WrongTestSuite {
  name: string;
  cases: readonly WrongTemplateTestCase[];
}

export function createWrongTemplateTest(
  Template: TemplateConstructor,
): (
  suites: readonly WrongTestSuite[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    suites: readonly WrongTestSuite[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { name, cases } of suites) {
      await t.step(name, async (t) => {
        for (const { name, template, expected } of cases) {
          await t.step(
            `${template} — ${name}`,
            () => throws(() => new Template(template), ERROR_CLASSES[expected]),
          );
        }
      });
    }
  };
}

/**
 * A single hard-mode test case. Each case carries its own template (unlike
 * {@link FixedTemplateTestSuite} where the suite shares one template).
 *
 * The shape of {@link HardTestCase.expected} is determined by
 * {@link HardTestCase.success}:
 *
 *  - `success: true`  → `expected` is the exact expansion result string.
 *  - `success: false` → `expected` is the `name` of the error class that the
 *    parser or expander MUST throw, taken from the concrete classes exported
 *    by *src/template/errors.ts*. The runner verifies the thrown error via
 *    `instanceof` against the resolved class.
 *
 * Use {@link HardTestCase.reason} for the human-readable rationale.
 */
type HardTestCase = HardSuccessCase | HardFailureCase;

interface HardCaseBase {
  /** Human-readable name of the case, used as the test step label. */
  name: string;
  /** URI template string to parse and expand. */
  template: string;
  /** Optional rationale explaining why this case behaves as specified. */
  reason?: string;
}

interface HardSuccessCase extends HardCaseBase {
  /** The exact string that the template MUST expand to. */
  expected: string;
  /** Marks this as a success case. */
  success: true;
}

interface HardFailureCase extends HardCaseBase {
  /**
   * The `name` of the error class that the parser or expander MUST throw,
   * taken from the concrete classes exported by *src/template/errors.ts* (e.g.
   * `"UnclosedExpressionError"`, `"PrefixModifierNotApplicableError"`).
   *
   * The runner compares the thrown error's `instanceof` against the class
   * resolved from this name; subclasses count as a match.
   */
  expected: ErrorName;
  /** Marks this as a failure case. */
  success: false;
}

/**
 * A suite of {@link HardTestCase}s grouped under a common theme.
 *
 * Unlike {@link PairTestSuite} (uniform success cases) or
 * {@link FixedTemplateTestSuite} (one fixed template, varying contexts),
 * a hard-mode suite mixes per-case templates and may include both
 * success and failure cases in the same suite.
 */
export interface HardTestSuite {
  /** Human-readable name of the suite. */
  name: string;
  /** Cases belonging to this suite. */
  cases: readonly HardTestCase[];
}

export function createTemplateHardTest(
  Template: TemplateConstructor,
): (
  suites: readonly HardTestSuite[],
  context?: ExpandContext,
) => (t: Deno.TestContext) => Promise<void> {
  return (
    suites: readonly HardTestSuite[],
    context: ExpandContext = testVars,
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { name, cases } of suites) {
      await t.step(name, async (t) => {
        for (const c of cases) {
          await t.step(c.name, () => {
            if (c.success) {
              equal(new Template(c.template).expand(context), c.expected);
            } else {
              throws(
                () => new Template(c.template).expand(context),
                ERROR_CLASSES[c.expected],
              );
            }
          });
        }
      });
    }
  };
}

export function createTemplateMatchHardTest(
  Template: TemplateConstructor,
): (
  cases: readonly HardTestCase[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    cases: readonly HardTestCase[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const c of cases) {
      if (!c.success) continue;
      await t.step(c.name, () => {
        const instance = new Template(c.template);
        const matched = instance.match(c.expected);
        ok(matched != null, `match returned null for ${c.expected}`);
        equal(instance.expand(matched), c.expected);
      });
    }
  };
}
