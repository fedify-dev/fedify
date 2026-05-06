import { deepEqual, equal, throws } from "node:assert/strict";
import * as ERROR_CLASS_BY_NAME from "../router/errors.ts";
import type { Path } from "../types.ts";

type ErrorName = keyof typeof ERROR_CLASS_BY_NAME;

interface RouterTestOptions {
  readonly trailingSlashInsensitive?: boolean;
}

interface RouterRouteResult {
  readonly name: string;
  readonly template: Path;
  readonly values: Record<string, string>;
}

interface RouterInstance<TPattern> {
  add(pattern: Path, name: string): void;
  build(name: string, values: Record<string, string>): Path | null;
  has(name: string): boolean;
  route(path: Path): RouterRouteResult | null;
  clone(): RouterInstance<TPattern>;
}

interface RouterConstructor<TPattern> {
  new (options?: RouterTestOptions): RouterInstance<TPattern>;
}

interface RouterExtendedConstructor<TPattern>
  extends RouterConstructor<TPattern> {
  compile(path: Path): TPattern;
  variables(path: Path): Set<string>;
}

export type RouterRouteDefinition = readonly [path: Path, name: string];

export type RouterBuildCase = readonly [
  routeName: string,
  values: Record<string, string>,
];

export interface RouterRouteCase {
  readonly name: string;
  readonly path: Path;
  readonly expected: RouterRouteResult | null;
}

export interface RouterRouteTestSuite {
  readonly name: string;
  readonly options?: RouterTestOptions;
  readonly routeDefinitions: readonly RouterRouteDefinition[];
  readonly cases: readonly RouterRouteCase[];
}

export interface RouterBuildTestCase {
  readonly name: string;
  readonly routeName: string;
  readonly values: Record<string, string>;
  readonly expected: string | null;
}

export interface RouterBuildTestSuite {
  readonly name: string;
  readonly options?: RouterTestOptions;
  readonly routeDefinitions: readonly RouterRouteDefinition[];
  readonly cases: readonly RouterBuildTestCase[];
}

export interface RouterVariablesCase {
  readonly name: string;
  readonly path: Path;
  readonly expected: readonly string[];
}

export interface RouterCompileErrorCase {
  readonly name: string;
  readonly path: string;
  readonly expected: readonly ErrorName[];
}

export interface RouterCloneTestSuite {
  readonly name: string;
  readonly options?: RouterTestOptions;
  readonly routeDefinitions: readonly RouterRouteDefinition[];
  readonly clonedRouteDefinitions: readonly RouterRouteDefinition[];
  readonly originalRouteCases: readonly RouterRouteCase[];
  readonly clonedRouteCases: readonly RouterRouteCase[];
}

export interface RouterMemoryPressureScenario {
  readonly name: string;
  readonly routeDefinitions: readonly RouterRouteDefinition[];
  readonly hitPaths: readonly Path[];
  readonly missPaths: readonly Path[];
  readonly routeName: string;
}

let routerBenchSink = 0;

const consumeRouterBenchValue = (value: number): void => {
  routerBenchSink = (routerBenchSink + value) | 0;
};

const consumeRouterRoute = (result: RouterRouteResult | null): void => {
  consumeRouterBenchValue(
    (result?.name.length ?? 0) + (result?.template.length ?? 0),
  );
};

const consumeRouterPath = (path: Path | null): void => {
  consumeRouterBenchValue(path?.length ?? 0);
};

const createRouterDefinitions = (
  count: number,
  createDefinition: (index: number) => RouterRouteDefinition,
): readonly RouterRouteDefinition[] =>
  Array.from({ length: count }, (_, index) => createDefinition(index));

const createSampledIndexes = (count: number, sampleCount: number): number[] =>
  Array.from(
    { length: sampleCount },
    (_, index) => Math.floor(index * count / sampleCount),
  );

const padRouterIndex = (index: number): string =>
  index.toString().padStart(4, "0");

export function createRouterHundredsOfRoutesScenario(): RouterMemoryPressureScenario {
  const routeDefinitions = createRouterDefinitions(
    512,
    (index): RouterRouteDefinition => [
      `/bulk/group-${index % 16}/items/${padRouterIndex(index)}/{id}`,
      `bulk${padRouterIndex(index)}`,
    ],
  );
  const sampledIndexes = createSampledIndexes(512, 16);

  return {
    name: "hundreds of routes",
    routeDefinitions,
    hitPaths: sampledIndexes.map((index) =>
      `/bulk/group-${index % 16}/items/${padRouterIndex(index)}/value` as Path
    ),
    missPaths: sampledIndexes.map((index) =>
      `/bulk/group-${index % 16}/missing/${padRouterIndex(index)}/value` as Path
    ),
    routeName: `bulk${padRouterIndex(511)}`,
  };
}

export function createRouterDeepCommonPrefixScenario(): RouterMemoryPressureScenario {
  const segments = Array.from(
    { length: 128 },
    (_, index) => `segment-${padRouterIndex(index)}`,
  );
  const routeDefinitions = segments.map((
    _,
    index,
  ): RouterRouteDefinition => [
    `/deep/${segments.slice(0, index + 1).join("/")}` as Path,
    `deep${padRouterIndex(index)}`,
  ]);
  const deepestPath = `/deep/${segments.join("/")}` as Path;

  return {
    name: "deep common prefix",
    routeDefinitions,
    hitPaths: [deepestPath],
    missPaths: [`${deepestPath}/missing` as Path],
    routeName: `deep${padRouterIndex(127)}`,
  };
}

export function createRouterRootAdjacentDynamicRoutesScenario(): RouterMemoryPressureScenario {
  const routeDefinitions = createRouterDefinitions(
    384,
    (index): RouterRouteDefinition => [
      `/{tenant}/resource-${padRouterIndex(index)}/{id}`,
      `rootDynamic${padRouterIndex(index)}`,
    ],
  );
  const sampledIndexes = createSampledIndexes(384, 16);

  return {
    name: "root-adjacent dynamic routes",
    routeDefinitions,
    hitPaths: sampledIndexes.map((index) =>
      `/alice/resource-${padRouterIndex(index)}/value` as Path
    ),
    missPaths: sampledIndexes.map((index) =>
      `/alice/missing-${padRouterIndex(index)}/value` as Path
    ),
    routeName: `rootDynamic${padRouterIndex(383)}`,
  };
}

export function createRouterInactiveEntriesScenario(): RouterMemoryPressureScenario {
  return {
    name: "inactive entries",
    routeDefinitions: createRouterDefinitions(
      512,
      (index): RouterRouteDefinition => [
        `/{tenant}/inactive-${padRouterIndex(index)}/{id}`,
        "replaced",
      ],
    ),
    hitPaths: [`/alice/inactive-${padRouterIndex(511)}/value`],
    missPaths: ["/alice/inactive-missing/value"],
    routeName: "replaced",
  };
}

const createRouterFromDefinitions = <TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
  definitions: readonly RouterRouteDefinition[],
  options: RouterTestOptions = {},
): RouterInstance<TPattern> => {
  const router = new Router(options);

  for (const [path, name] of definitions) {
    router.add(path, name);
  }

  return router;
};

export function createRouterAddTest<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  definitions: readonly RouterRouteDefinition[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    definitions: readonly RouterRouteDefinition[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    const router = new Router();

    for (const [path, name] of definitions) {
      await t.step(`${path} as ${name}`, () => {
        equal(router.add(path, name), undefined);
        equal(router.has(name), true);
      });
    }
  };
}

export function createRouterCompileErrorTest<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  cases: readonly RouterCompileErrorCase[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    cases: readonly RouterCompileErrorCase[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { name, path, expected } of cases) {
      await t.step(name, () => {
        for (const errorName of expected) {
          throws(
            () => Router.compile(path as Path),
            ERROR_CLASS_BY_NAME[errorName],
          );
        }
      });
    }
  };
}

export function createRouterVariablesTest<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  cases: readonly RouterVariablesCase[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    cases: readonly RouterVariablesCase[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const { name, path, expected } of cases) {
      await t.step(
        name,
        () => deepEqual(Router.variables(path), new Set(expected)),
      );
    }
  };
}

export function createRouterRouteTest<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  routeDefinitions: readonly RouterRouteDefinition[],
  options?: RouterTestOptions,
) => (
  cases: readonly RouterRouteCase[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    routeDefinitions: readonly RouterRouteDefinition[],
    options: RouterTestOptions = {},
  ): (
    cases: readonly RouterRouteCase[],
  ) => (t: Deno.TestContext) => Promise<void> => {
    const router = createRouterFromDefinitions(
      Router,
      routeDefinitions,
      options,
    );

    return (
      cases: readonly RouterRouteCase[],
    ): (t: Deno.TestContext) => Promise<void> =>
    async (t: Deno.TestContext): Promise<void> => {
      for (const { name, path, expected } of cases) {
        await t.step(
          name,
          () => deepEqual(router.route(path), expected),
        );
      }
    };
  };
}

export function createRouterBuildTest<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  routeDefinitions: readonly RouterRouteDefinition[],
  options?: RouterTestOptions,
) => (
  cases: readonly RouterBuildTestCase[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    routeDefinitions: readonly RouterRouteDefinition[],
    options: RouterTestOptions = {},
  ): (
    cases: readonly RouterBuildTestCase[],
  ) => (t: Deno.TestContext) => Promise<void> => {
    const router = createRouterFromDefinitions(
      Router,
      routeDefinitions,
      options,
    );

    return (
      cases: readonly RouterBuildTestCase[],
    ): (t: Deno.TestContext) => Promise<void> =>
    async (t: Deno.TestContext): Promise<void> => {
      for (const { name, routeName, values, expected } of cases) {
        await t.step(
          name,
          () => equal(router.build(routeName, values), expected),
        );
      }
    };
  };
}

export function createRouterCloneTest<TPattern>(
  Router: RouterConstructor<TPattern>,
): (
  suites: readonly RouterCloneTestSuite[],
) => (t: Deno.TestContext) => Promise<void> {
  return (
    suites: readonly RouterCloneTestSuite[],
  ): (t: Deno.TestContext) => Promise<void> =>
  async (t: Deno.TestContext): Promise<void> => {
    for (const suite of suites) {
      await t.step(suite.name, () => {
        const original = new Router(suite.options);
        for (const [path, name] of suite.routeDefinitions) {
          original.add(path, name);
        }
        const clone = original.clone();

        for (const [path, name] of suite.clonedRouteDefinitions) {
          clone.add(path, name);
        }
        for (const [, name] of suite.routeDefinitions) {
          equal(original.has(name), true);
          equal(clone.has(name), true);
        }
        for (const [, name] of suite.clonedRouteDefinitions) {
          equal(original.has(name), false);
          equal(clone.has(name), true);
        }
        for (const { path, expected } of suite.originalRouteCases) {
          deepEqual(original.route(path), expected);
        }
        for (const { path, expected } of suite.clonedRouteCases) {
          deepEqual(clone.route(path), expected);
        }
      });
    }
  };
}

export function createRouterCompileAndAddBench<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  routeDefinitions: readonly RouterRouteDefinition[],
  routeName: string,
) => () => void {
  return (
    routeDefinitions: readonly RouterRouteDefinition[],
    routeName: string,
  ): () => void => {
    const createRouter = (): RouterInstance<TPattern> =>
      createRouterFromDefinitions(Router, routeDefinitions);

    return (): void => {
      for (let count = 0; count < 100; count++) {
        const router = createRouter();
        consumeRouterBenchValue(router.has(routeName) ? 1 : 0);
      }
    };
  };
}

export function createRouterFirstRouteAfterBuildBench<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  routeDefinitions: readonly RouterRouteDefinition[],
  path: Path,
) => () => void {
  return (
    routeDefinitions: readonly RouterRouteDefinition[],
    path: Path,
  ): () => void =>
  (): void => {
    const router = createRouterFromDefinitions(Router, routeDefinitions);
    consumeRouterRoute(router.route(path));
  };
}

export function createRouterRouteHitsBench<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  routeDefinitions: readonly RouterRouteDefinition[],
  paths: readonly Path[],
) => () => void {
  return (
    routeDefinitions: readonly RouterRouteDefinition[],
    paths: readonly Path[],
  ): () => void => {
    const router = createRouterFromDefinitions(Router, routeDefinitions);

    return (): void => {
      for (const path of paths) {
        consumeRouterRoute(router.route(path));
      }
    };
  };
}

export function createRouterRouteMissesBench<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  routeDefinitions: readonly RouterRouteDefinition[],
  paths: readonly Path[],
) => () => void {
  return (
    routeDefinitions: readonly RouterRouteDefinition[],
    paths: readonly Path[],
  ): () => void => {
    const router = createRouterFromDefinitions(Router, routeDefinitions);

    return (): void => {
      for (const path of paths) {
        consumeRouterRoute(router.route(path));
      }
    };
  };
}

export function createRouterBuildPathsBench<TPattern>(
  Router: RouterExtendedConstructor<TPattern>,
): (
  routeDefinitions: readonly RouterRouteDefinition[],
  cases: readonly RouterBuildCase[],
) => () => void {
  return (
    routeDefinitions: readonly RouterRouteDefinition[],
    cases: readonly RouterBuildCase[],
  ): () => void => {
    const router = createRouterFromDefinitions(Router, routeDefinitions);

    return (): void => {
      for (const [routeName, values] of cases) {
        consumeRouterPath(router.build(routeName, values));
      }
    };
  };
}
