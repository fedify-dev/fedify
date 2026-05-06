import { test } from "@fedify/fixture";
import {
  createRouterAddTest,
  createRouterBuildTest,
  createRouterCloneTest,
  createRouterCompileErrorTest,
  createRouterRouteTest,
  createRouterVariablesTest,
  routerBuildTestSuites,
  routerCloneTestSuites,
  routerCompileErrorCases,
  routerRouteDefinitions,
  routerRouteTestSuites,
  routerVariablesCases,
} from "../tests/mod.ts";
import Router from "./router.ts";

const runAddCases = createRouterAddTest(Router);
test("Router.add()", runAddCases(routerRouteDefinitions));

const runCompileErrorCases = createRouterCompileErrorTest(Router);
test(
  "Router.compile() rejects invalid templates",
  runCompileErrorCases(routerCompileErrorCases),
);

const runVariablesCases = createRouterVariablesTest(Router);
test("Router.variables()", runVariablesCases(routerVariablesCases));

const runCloneCases = createRouterCloneTest(Router);
test("Router.clone()", runCloneCases(routerCloneTestSuites));

const runRouteCases = createRouterRouteTest(Router);
for (
  const { name, options, routeDefinitions, cases } of routerRouteTestSuites
) {
  test(
    `Router.route(): ${name}`,
    runRouteCases(routeDefinitions, options)(cases),
  );
}

const runBuildCases = createRouterBuildTest(Router);
for (
  const { name, options, routeDefinitions, cases } of routerBuildTestSuites
) {
  test(
    `Router.build(): ${name}`,
    runBuildCases(routeDefinitions, options)(cases),
  );
}
