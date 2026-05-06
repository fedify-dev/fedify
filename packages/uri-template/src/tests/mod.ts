import type { Path } from "../types.ts";
import {
  assertHardTestSuite,
  assertMatchTestSuite,
  assertPairTestSuite,
  assertRouterBuildCases,
  assertRouterBuildTestSuites,
  assertRouterCloneTestSuites,
  assertRouterCompileErrorCases,
  assertRouterPaths,
  assertRouterRouteDefinitions,
  assertRouterRouteTestSuites,
  assertRouterVariablesCases,
  assertWrongTestSuite,
} from "./assert.ts";
import _hardTestSuites from "./json/hard.json" with {
  type: "json",
};
import _matchTestSuites from "./json/match.json" with { type: "json" };
import _fixedTestSuites from "./json/references/fixed.json" with {
  type: "json",
};
import _pairTestSuites from "./json/references/pairs.json" with {
  type: "json",
};
import _routerBuildCases from "./json/router/build-cases.json" with {
  type: "json",
};
import _routerBuildTestSuites from "./json/router/build-suites.json" with {
  type: "json",
};
import _routerCloneTestSuites from "./json/router/clone-suites.json" with {
  type: "json",
};
import _routerCompileErrorCases from "./json/router/compile-error-cases.json" with {
  type: "json",
};
import _routerHitPaths from "./json/router/hit-paths.json" with {
  type: "json",
};
import _routerMissPaths from "./json/router/miss-paths.json" with {
  type: "json",
};
import _routerRouteDefinitions from "./json/router/route-definitions.json" with {
  type: "json",
};
import _routerRouteTestSuites from "./json/router/route-suites.json" with {
  type: "json",
};
import _routerVariablesCases from "./json/router/variables-cases.json" with {
  type: "json",
};
import _wrongTestSuites from "./json/wrong.json" with { type: "json" };
import type {
  FixedTemplateTestSuite,
  HardTestSuite,
  MatchTestSuite,
  PairTestSuite,
  WrongTestSuite,
} from "./lib.ts";
import type {
  RouterBuildCase,
  RouterBuildTestSuite,
  RouterCloneTestSuite,
  RouterCompileErrorCase,
  RouterRouteDefinition,
  RouterRouteTestSuite,
  RouterVariablesCase,
} from "./router.ts";

type JsonAssertion<T> = (value: unknown) => asserts value is T;

const validate = <T>(validate: JsonAssertion<T>, value: unknown): T => {
  validate(value);
  return value;
};

export const pairTestSuites: readonly PairTestSuite[] = validate(
  assertPairTestSuite,
  _pairTestSuites,
);
export const fixedTestSuites: readonly FixedTemplateTestSuite[] =
  _fixedTestSuites;
export const wrongTestSuites: readonly WrongTestSuite[] = validate(
  assertWrongTestSuite,
  _wrongTestSuites,
);
export const hardTestSuites: readonly HardTestSuite[] = validate(
  assertHardTestSuite,
  _hardTestSuites,
);
export const matchTestSuites: readonly MatchTestSuite[] = validate(
  assertMatchTestSuite,
  _matchTestSuites,
);
export const routerRouteDefinitions: readonly RouterRouteDefinition[] =
  validate(
    assertRouterRouteDefinitions,
    _routerRouteDefinitions,
  );
export const routerHitPaths: readonly Path[] = validate(
  assertRouterPaths,
  _routerHitPaths,
);
export const routerMissPaths: readonly Path[] = validate(
  assertRouterPaths,
  _routerMissPaths,
);
export const routerBuildCases: readonly RouterBuildCase[] = validate(
  assertRouterBuildCases,
  _routerBuildCases,
);
export const routerRouteTestSuites: readonly RouterRouteTestSuite[] = validate(
  assertRouterRouteTestSuites,
  _routerRouteTestSuites,
);
export const routerBuildTestSuites: readonly RouterBuildTestSuite[] = validate(
  assertRouterBuildTestSuites,
  _routerBuildTestSuites,
);
export const routerVariablesCases: readonly RouterVariablesCase[] = validate(
  assertRouterVariablesCases,
  _routerVariablesCases,
);
export const routerCompileErrorCases: readonly RouterCompileErrorCase[] =
  validate(assertRouterCompileErrorCases, _routerCompileErrorCases);
export const routerCloneTestSuites: readonly RouterCloneTestSuite[] = validate(
  assertRouterCloneTestSuites,
  _routerCloneTestSuites,
);
export {
  createFixedTemplateMatchTest,
  createFixedTemplateTest,
  createMatchOnlyTest,
  createTemplateHardTest,
  createTemplateMatchHardTest,
  createTemplateMatchTest,
  createTemplatePairTest,
  createWrongTemplateTest,
} from "./lib.ts";
export {
  createRouterAddTest,
  createRouterBuildPathsBench,
  createRouterBuildTest,
  createRouterCloneTest,
  createRouterCompileAndAddBench,
  createRouterCompileErrorTest,
  createRouterDeepCommonPrefixScenario,
  createRouterFirstRouteAfterBuildBench,
  createRouterHundredsOfRoutesScenario,
  createRouterInactiveEntriesScenario,
  createRouterRootAdjacentDynamicRoutesScenario,
  createRouterRouteHitsBench,
  createRouterRouteMissesBench,
  createRouterRouteTest,
  createRouterVariablesTest,
  type RouterMemoryPressureScenario,
} from "./router.ts";
