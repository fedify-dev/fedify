import { test } from "@fedify/fixture";
// deno-lint-ignore no-import-prefix
import { parseTemplate } from "npm:url-template@^3.1.1";
import {
  createFixedTemplateTest,
  createTemplateHardTest,
  createTemplatePairTest,
  createWrongTemplateTest,
  fixedTestSuites,
  hardTestSuites,
  pairTestSuites,
  wrongTestSuites,
} from "../src/tests/mod.ts";

/**
 * Known failures for npm:url-template@^3.1.1, checked with
 * `deno task test:old`.
 * These are the compatibility gaps that motivated the strict
 * @fedify/uri-template implementation.
 *
 * Expected-error cases that throw a different npm error are intentionally
 * excluded. In the current run, none of the failing expected-error cases fell
 * into that category; npm:url-template accepted and expanded them instead.
 *
 * RFC 6570 grounds for the expected behavior:
 *
 *  -  Section 2 defines a URI Template as zero or more literals or
 *     expressions, and each expression is delimited by a matching pair of
 *     braces. Section 3.2 also states that expressions cannot be nested.
 *  -  Section 2.1 excludes CTL, SP, DQUOTE, "'", raw "%" outside a
 *     pct-encoded triplet, "<", ">", "\", "^", "`", "{", "|", and "}" from
 *     literals.
 *  -  Section 2.3 defines `varname` as `varchar *( ["."] varchar )`, where
 *     `varchar` includes `pct-encoded`, and says pct-encoded triplets in a
 *     varname are essential parts of the variable name and are not decoded.
 *  -  Section 3.2.8 says query expansion appends the variable name encoded as
 *     if it were a literal string. Since Section 2.1 permits `pct-encoded` in
 *     literals, a pct-encoded triplet in a variable name must be preserved and
 *     must not be encoded again.
 *  -  Section 2.4.1 says prefix modifiers are not applicable to variables
 *     that have composite values.
 *  -  Section 3 says grammar errors SHOULD indicate the location and type of
 *     error to the invoking application. @fedify/uri-template reports these
 *     cases as typed errors; npm:url-template silently returns a best-effort
 *     expansion for the cases below.
 *
 * Successful cases with different output:
 *
 *  -  `{?abc%20def}` expands to `?abc%2520def=spaced`; expected
 *     `?abc%20def=spaced`.
 *  -  `{?%41}` expands to `?%2541=encoded-A`; expected `?%41=encoded-A`.
 *
 * Invalid templates accepted by npm:url-template:
 *
 *  -  `wrongTestSuites`: all 75 negative parser cases are accepted:
 *      Brackets not matched (9/9), Duplicated brackets (8/8), Wrong position
 *      of level 4 modifier (10/10), Wrong prefix modifier (10/10), Invalid
 *      characters in literals (21/21), and Invalid characters in expression
 *      (17/17).
 *  -  `hardTestSuites` with `success: false`: all 10 negative cases are
 *     accepted: `%7Bvar}`, `{var%7D`, `}%7B%7D`, `%7B}`,
 *     `{var%7B%7D`, `{list:3}`, `{keys:3}`, `{?list:6}`, `{/keys:4}`,
 *     and `{count:2}`.
 */
class Template {
  expand;
  constructor(template: string) {
    const { expand } = parseTemplate(template);
    this.expand = expand;
  }
  match = (_: string) => null;
}

const isTest = Deno.env.get("OLD") === "true";

if (isTest) {
  const runPairCases = createTemplatePairTest(Template);
  for (const { name, cases } of pairTestSuites) {
    test(name, runPairCases(cases as unknown as readonly [string, string][]));
  }

  const runFixedCases = createFixedTemplateTest(Template);
  for (const { template, name, cases } of fixedTestSuites) {
    test(name, runFixedCases(template)(cases));
  }

  const runWrongCases = createWrongTemplateTest(Template);
  for (const { name, cases } of wrongTestSuites) {
    test(name, runWrongCases(cases));
  }

  const runHardCases = createTemplateHardTest(Template);
  for (const { name, cases } of hardTestSuites) {
    test(name, runHardCases(cases));
  }
}
