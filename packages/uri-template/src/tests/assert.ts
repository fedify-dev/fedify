import * as ERROR_CLASSES from "../errors.ts";
import type {
  HardTestSuite,
  MatchTestSuite,
  PairTestSuite,
  WrongTestSuite,
} from "./lib.ts";

const ERROR_NAMES: ReadonlySet<string> = new Set(Object.keys(ERROR_CLASSES));

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
