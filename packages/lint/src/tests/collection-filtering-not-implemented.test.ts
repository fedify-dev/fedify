import { test } from "node:test";
import { properties, RULE_IDS } from "../lib/const.ts";
import { COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR as expectedError } from "../lib/messages.ts";
import lintTest from "../lib/test.ts";
import * as rule from "../rules/collection-filtering-not-implemented.ts";

const ruleName = RULE_IDS.collectionFilteringNotImplemented;
const filterless = ["ctx", "identifier", "cursor"] as const;

// Helper to create test code for setFollowersDispatcher
const createFollowersDispatcherCode = (
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
    federation.setFollowersDispatcher(
      "/users/{identifier}/followers",
      ${asyncKeyword} ${funcKeyword}(${paramsString}) ${arrowSymbol} {
        return { items: [] };
      }
    );
  `;
};

test(
  `${ruleName}: ✅ Good - async arrow function with filter parameter`,
  lintTest({
    code: createFollowersDispatcherCode(),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - async function expression with filter`,
  lintTest({
    code: createFollowersDispatcherCode({ arrow: false }),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - sync arrow function with filter`,
  lintTest({
    code: createFollowersDispatcherCode({ async: false }),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ✅ Good - sync function expression with filter`,
  lintTest({
    code: createFollowersDispatcherCode({ async: false, arrow: false }),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - async arrow function without filter parameter`,
  lintTest({
    code: createFollowersDispatcherCode({ params: filterless }),
    rule,
    ruleName,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - async function expression without filter`,
  lintTest({
    code: createFollowersDispatcherCode({ params: filterless, arrow: false }),
    rule,
    ruleName,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - sync arrow function expression without filter`,
  lintTest({
    code: createFollowersDispatcherCode({ params: filterless, async: false }),
    rule,
    ruleName,
    expectedError,
  }),
);

test(
  `${ruleName}: ❌ Bad - sync function expression without filter`,
  lintTest({
    code: createFollowersDispatcherCode({
      params: filterless,
      async: false,
      arrow: false,
    }),
    rule,
    ruleName,
    expectedError,
  }),
);

test(
  `${ruleName}: ✅ Good - 4th parameter but unnamed filter`,
  lintTest({
    code: createFollowersDispatcherCode({
      params: ["ctx", "identifier", "cursor", "baseUri"],
    }),
    rule,
    ruleName,
  }),
);

test(
  `${ruleName}: ❌ Bad - only two parameters (missing cursor and filter)`,
  lintTest({
    code: createFollowersDispatcherCode({ params: ["ctx", "identifier"] }),
    rule,
    ruleName,
    expectedError,
  }),
);

test(
  `${ruleName}: ✅ Good - non-federation object is not checked`,
  lintTest({
    code: createFollowersDispatcherCode({ params: filterless }),
    rule,
    ruleName,
    federationSetup: `
      const federation = {
        setFollowersDispatcher: () => {}
      };
    `,
  }),
);

// Test that other collection dispatchers are NOT checked
const otherDispatchers = [
  "following",
  "outbox",
  "liked",
  "featured",
  "featuredTags",
] as const satisfies (keyof typeof properties)[];

const paramsString = filterless.join(", ");

test(
  `${ruleName}: ✅ Good - other collection dispatchers without filter are NOT checked`,
  lintTest({
    code: otherDispatchers.map((name) =>
      `federation.${properties[name].setter}(
        "/users/{identifier}/${name}",
        async (${paramsString}) => { items: [] },
      );`
    ).join("\n"),
    rule,
    ruleName,
  }),
);
