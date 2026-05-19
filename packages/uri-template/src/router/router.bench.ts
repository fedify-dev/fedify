import {
  createDeepPrefixRouterTest,
  createDynamicRoutesTest,
  createInactiveEntriesTest,
  createRouterBuildPathsBench,
  createRouterCompileAndAddBench,
  createRouterFirstRouteAfterBuildBench,
  createRouterRouteHitsBench,
  createRouterRouteMissesBench,
  createRoutesPressureTest,
  routerBuildCases,
  routerHitPaths,
  routerMissPaths,
  routerRouteDefinitions,
} from "../tests/mod.ts";
import Router from "./router.ts";

const runCompileAndAddRoutes = createRouterCompileAndAddBench(Router);
Deno.bench(
  "Router: compile and add routes",
  runCompileAndAddRoutes(routerRouteDefinitions, "actor"),
);

const runRouteHits = createRouterRouteHitsBench(Router);
Deno.bench(
  "Router: route mixed hits",
  runRouteHits(routerRouteDefinitions, routerHitPaths),
);

const runRouteMisses = createRouterRouteMissesBench(Router);
Deno.bench(
  "Router: route misses",
  runRouteMisses(routerRouteDefinitions, routerMissPaths),
);

const runBuildPaths = createRouterBuildPathsBench(Router);
Deno.bench(
  "Router: build paths",
  runBuildPaths(routerRouteDefinitions, routerBuildCases),
);

const runFirstRouteAfterBuild = createRouterFirstRouteAfterBuildBench(Router);
for (
  const scenario of [
    createRoutesPressureTest(),
    createDeepPrefixRouterTest(),
    createDynamicRoutesTest(),
    createInactiveEntriesTest(),
  ]
) {
  Deno.bench(
    `Router: ${scenario.name}: compile and add routes`,
    runCompileAndAddRoutes(scenario.routeDefinitions, scenario.routeName),
  );
  Deno.bench(
    `Router: ${scenario.name}: first route after build`,
    runFirstRouteAfterBuild(scenario.routeDefinitions, scenario.hitPaths[0]),
  );
  Deno.bench(
    `Router: ${scenario.name}: route hits`,
    runRouteHits(scenario.routeDefinitions, scenario.hitPaths),
  );
  Deno.bench(
    `Router: ${scenario.name}: route misses`,
    runRouteMisses(scenario.routeDefinitions, scenario.missPaths),
  );
}
