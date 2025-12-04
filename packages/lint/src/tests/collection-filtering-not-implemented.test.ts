import { test } from "node:test";
import { properties } from "../lib/const.ts";
import { COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR as expectedError } from "../lib/messages.ts";
import { testDenoLint } from "../lib/test.ts";
import {
  COLLECTION_FILTERING_NOT_IMPLEMENTED as ruleName,
  default as rule,
} from "../rules/collection-filtering-not-implemented.ts";

const filterless = ["ctx", "identifier", "cursor"] as const;

test(
  `${ruleName}: ✅ Good - async arrow function with filter parameter`,
  createTestCode(),
);

test(
  `${ruleName}: ✅ Good - async function expression with filter`,
  createTestCode({ arrow: false }),
);

test(
  `${ruleName}: ✅ Good - sync arrow function with filter`,
  createTestCode({ async: false }),
);

test(
  `${ruleName}: ✅ Good - sync function expression with filter`,
  createTestCode({ async: false, arrow: false }),
);

test(
  `${ruleName}: ❌ Bad - async arrow function without filter parameter`,
  createTestCode({ params: filterless }, expectedError),
);

test(
  `${ruleName}: ❌ Bad - async function expression without filter`,
  createTestCode({ params: filterless, arrow: false }, expectedError),
);

test(
  `${ruleName}: ❌ Bad - sync arrow function expression without filter`,
  createTestCode({ params: filterless, async: false }, expectedError),
);

test(
  `${ruleName}: ❌ Bad - sync function expression without filter`,
  createTestCode(
    { params: filterless, async: false, arrow: false },
    expectedError,
  ),
);

test(
  `${ruleName}: ✅ Good - 4th parameter but unnamed filter`,
  createTestCode({ params: ["ctx", "identifier", "cursor", "somethingElse"] }),
);

test(
  `${ruleName}: ❌ Bad - only two parameters (missing cursor and filter)`,
  createTestCode({ params: ["ctx", "identifier"] }, expectedError),
);

test(`${ruleName}: ✅ Good - non-federation object is not checked`, () =>
  filterNeeded.forEach((name) =>
    testDenoLint({
      code: createDispatcherCode(name, { params: filterless }),
      rule,
      ruleName,
      federationSetup: `
        const federation = {
          ${properties[name].setter}: () => {}
        };
      `,
    })
  ));

function createTestCode(
  codeOptions: Parameters<typeof createDispatcherCode>[1] = {},
  expectedError?: string,
) {
  return () =>
    filterNeeded.forEach((name) =>
      testDenoLint({
        code: createDispatcherCode(name, codeOptions),
        rule,
        ruleName,
        expectedError,
      })
    );
}

const filterNeeded = [
  "followers",
  "following",
  "outbox",
  "liked",
  "featured",
  "featuredTags",
] as const satisfies (keyof typeof properties)[];

const createDispatcherCode = (
  name: keyof typeof properties,
  {
    params = ["ctx", "identifier", "cursor", "filter"],
    async = true,
    arrow = true,
  }: {
    params?: readonly string[];
    async?: boolean;
    arrow?: boolean;
  } = {},
): string => {
  const paramsString = params.join(", ");
  const asyncKeyword = async ? "async" : "";
  const [funcKeyword, arrowSymbol] = arrow ? ["", "=>"] : ["function", ""];

  return `
    federation.${properties[name].setter}(
      "/users/{identifier}/${name}",
      ${asyncKeyword} ${funcKeyword}(${paramsString}) ${arrowSymbol} {
        return { items: [] };
      }
    );
  `;
};
