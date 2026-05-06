import * as ROUTER_ERROR_CLASSES from "../router/errors.ts";
import * as ERROR_CLASSES from "../template/errors.ts";
import type { Path } from "../types.ts";
import type {
  RouterBuildCase,
  RouterBuildTestSuite,
  RouterCloneTestSuite,
  RouterCompileErrorCase,
  RouterRouteDefinition,
  RouterRouteTestSuite,
  RouterVariablesCase,
} from "./router.ts";
import type {
  HardTestSuite,
  MatchTestSuite,
  PairTestSuite,
  WrongTestSuite,
} from "./template.ts";

export function assertPairTestSuite(
  suites: unknown,
): asserts suites is readonly PairTestSuite[] {
  validateSuites(suites, validatePairCase);
}

export function assertWrongTestSuite(
  suites: unknown,
): asserts suites is readonly WrongTestSuite[] {
  validateSuites(suites, validateWrongCase);
}

export function assertHardTestSuite(
  suites: unknown,
): asserts suites is readonly HardTestSuite[] {
  validateSuites(suites, validateHardCase);
}

export function assertMatchTestSuite(
  suites: unknown,
): asserts suites is readonly MatchTestSuite[] {
  validateSuites(suites, validateMatchCase);
}

export function assertRouterRouteDefinitions(
  definitions: unknown,
): asserts definitions is readonly RouterRouteDefinition[] {
  assertArray(definitions, "router route definitions");
  for (const definition of definitions) validateRouteDefinition(definition);
}

export function assertRouterPaths(
  paths: unknown,
): asserts paths is readonly Path[] {
  assertArray(paths, "router paths");
  for (const path of paths) assertPath(path, "router path");
}

export function assertRouterBuildCases(
  cases: unknown,
): asserts cases is readonly RouterBuildCase[] {
  assertArray(cases, "router build cases");
  for (const c of cases) validateRouterBuildCase(c);
}

export function assertRouterRouteTestSuites(
  suites: unknown,
): asserts suites is readonly RouterRouteTestSuite[] {
  assertArray(suites, "router route test suites");
  for (const suite of suites) validateRouterRouteTestSuite(suite);
}

export function assertRouterBuildTestSuites(
  suites: unknown,
): asserts suites is readonly RouterBuildTestSuite[] {
  assertArray(suites, "router build test suites");
  for (const suite of suites) validateRouterBuildTestSuite(suite);
}

export function assertRouterVariablesCases(
  cases: unknown,
): asserts cases is readonly RouterVariablesCase[] {
  assertArray(cases, "router variables cases");
  for (const c of cases) validateRouterVariablesCase(c);
}

export function assertRouterCompileErrorCases(
  cases: unknown,
): asserts cases is readonly RouterCompileErrorCase[] {
  assertArray(cases, "router compile error cases");
  for (const c of cases) validateRouterCompileErrorCase(c);
}

export function assertRouterCloneTestSuites(
  suites: unknown,
): asserts suites is readonly RouterCloneTestSuite[] {
  assertArray(suites, "router clone test suites");
  for (const suite of suites) validateRouterCloneTestSuite(suite);
}

function validateSuites(
  suites: unknown,
  validateCase: (c: unknown) => void,
): void {
  assertArray(suites, "suites");
  for (const suite of suites) {
    assertObject(suite, "suite");
    assertString(suite.name, "suite.name");
    assertArray(suite.cases, "suite.cases");
    for (const c of suite.cases) validateCase(c);
  }
}

function validatePairCase(c: unknown): void {
  if (
    !Array.isArray(c) || c.length !== 2 ||
    typeof c[0] !== "string" || typeof c[1] !== "string"
  ) {
    throw new TypeError(
      "each case must be a [template: string, expanded: string] tuple",
    );
  }
}

function validateWrongCase(c: unknown): void {
  assertObject(c, "case");
  assertString(c.name, "case.name");
  assertString(c.template, "case.template");
  assertErrorName(c.expected, "case.expected");
}

function validateHardCase(c: unknown): void {
  assertObject(c, "case");
  assertString(c.name, "case.name");
  assertString(c.template, "case.template");
  assertString(c.expected, "case.expected");
  assertBoolean(c.success, "case.success");
  if (c.reason !== undefined) assertString(c.reason, "case.reason");
  if (!c.success) assertErrorName(c.expected, "case.expected");
}

function validateMatchCase(c: unknown): void {
  assertObject(c, "case");
  assertString(c.name, "case.name");
  assertString(c.template, "case.template");
  assertString(c.uri, "case.uri");
  if (c.expected !== null) assertObject(c.expected, "case.expected");
  if (c.reason !== undefined) assertString(c.reason, "case.reason");
}

function validateRouteDefinition(value: unknown): void {
  if (
    !Array.isArray(value) || value.length !== 2 ||
    typeof value[1] !== "string"
  ) {
    throw new TypeError(
      "each route definition must be a [path: string, name: string] tuple",
    );
  }

  assertPath(value[0], "router route definition path");
}

function validateRouterBuildCase(value: unknown): void {
  if (
    !Array.isArray(value) || value.length !== 2 ||
    typeof value[0] !== "string"
  ) {
    throw new TypeError(
      "each router build case must be a [name: string, values: object] tuple",
    );
  }

  assertStringRecord(value[1], "router build case values");
}

function validateRouterRouteTestSuite(value: unknown): void {
  assertObject(value, "router route test suite");
  assertString(value.name, "router route test suite.name");
  if (value.options !== undefined) {
    validateRouterOptions(value.options, "router route test suite.options");
  }
  assertRouterRouteDefinitions(value.routeDefinitions);
  assertArray(value.cases, "router route test suite.cases");
  for (const c of value.cases) validateRouterRouteCase(c);
}

function validateRouterBuildTestSuite(value: unknown): void {
  assertObject(value, "router build test suite");
  assertString(value.name, "router build test suite.name");
  if (value.options !== undefined) {
    validateRouterOptions(value.options, "router build test suite.options");
  }
  assertRouterRouteDefinitions(value.routeDefinitions);
  assertArray(value.cases, "router build test suite.cases");
  for (const c of value.cases) validateRouterBuildTestCase(c);
}

function validateRouterCloneTestSuite(value: unknown): void {
  assertObject(value, "router clone test suite");
  assertString(value.name, "router clone test suite.name");
  if (value.options !== undefined) {
    validateRouterOptions(value.options, "router clone test suite.options");
  }
  assertRouterRouteDefinitions(value.routeDefinitions);
  assertRouterRouteDefinitions(value.clonedRouteDefinitions);
  assertArray(
    value.originalRouteCases,
    "router clone test suite.originalRouteCases",
  );
  for (const c of value.originalRouteCases) validateRouterRouteCase(c);
  assertArray(
    value.clonedRouteCases,
    "router clone test suite.clonedRouteCases",
  );
  for (const c of value.clonedRouteCases) validateRouterRouteCase(c);
}

function validateRouterRouteCase(value: unknown): void {
  assertObject(value, "router route case");
  assertString(value.name, "router route case.name");
  assertPath(value.path, "router route case.path");
  validateRouterRouteResult(value.expected, "router route case.expected");
}

function validateRouterBuildTestCase(value: unknown): void {
  assertObject(value, "router build test case");
  assertString(value.name, "router build test case.name");
  assertString(value.routeName, "router build test case.routeName");
  assertStringRecord(value.values, "router build test case.values");
  assertStringOrNull(value.expected, "router build test case.expected");
}

function validateRouterVariablesCase(value: unknown): void {
  assertObject(value, "router variables case");
  assertString(value.name, "router variables case.name");
  assertPath(value.path, "router variables case.path");
  assertStringArray(value.expected, "router variables case.expected");
}

function validateRouterCompileErrorCase(value: unknown): void {
  assertObject(value, "router compile error case");
  assertString(value.name, "router compile error case.name");
  assertString(value.path, "router compile error case.path");
  assertStringArray(value.expected, "router compile error case.expected");
  for (const errorName of value.expected) {
    assertErrorName(errorName, "router compile error case.expected");
  }
}

function validateRouterOptions(value: unknown, label: string): void {
  assertObject(value, label);
  if (value.trailingSlashInsensitive !== undefined) {
    assertBoolean(
      value.trailingSlashInsensitive,
      `${label}.trailingSlashInsensitive`,
    );
  }
}

function validateRouterRouteResult(value: unknown, label: string): void {
  if (value === null) return;

  assertObject(value, label);
  assertString(value.name, `${label}.name`);
  assertPath(value.template, `${label}.template`);
  assertStringRecord(value.values, `${label}.values`);
}

function assertString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
}

function assertBoolean(
  value: unknown,
  label: string,
): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertArray(
  value: unknown,
  label: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
}

function assertStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  assertArray(value, label);
  for (const item of value) assertString(item, label);
}

function assertPath(
  value: unknown,
  label: string,
): asserts value is Path {
  assertString(value, label);
  if (!value.startsWith("/") && !/^\{\/[^}]+\}\//.test(value)) {
    throw new TypeError(`${label} must be a router path`);
  }
}

function assertStringRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, string> {
  assertObject(value, label);
  for (const [key, item] of Object.entries(value)) {
    assertString(item, `${label}.${key}`);
  }
}

function assertStringOrNull(
  value: unknown,
  label: string,
): asserts value is string | null {
  if (value !== null) assertString(value, label);
}

const ERROR_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(ERROR_CLASSES),
  ...Object.keys(ROUTER_ERROR_CLASSES),
]);

function assertErrorName(
  value: unknown,
  label: string,
): asserts value is string {
  assertString(value, label);
  if (!ERROR_NAMES.has(value)) {
    throw new TypeError(
      `${label} must be one of [${[...ERROR_NAMES].join(", ")}], got ${
        JSON.stringify(value)
      }`,
    );
  }
}
