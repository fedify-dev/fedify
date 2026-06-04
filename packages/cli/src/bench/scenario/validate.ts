/**
 * Runtime validation of scenario suites against the embedded JSON Schema.
 * @since 2.3.0
 * @module
 */

import { type Schema, Validator } from "@cfworker/json-schema";
import { scenarioSchemaV1 } from "./schema.ts";
import { type RawValidationError, SuiteValidationError } from "./errors.ts";
import type { Suite } from "./types.ts";

let validator: Validator | undefined;

function getValidator(): Validator {
  validator ??= new Validator(scenarioSchemaV1 as unknown as Schema, "2020-12");
  return validator;
}

/**
 * Validates a parsed scenario suite against the schema and narrows its type.
 * @param raw The parsed (but untyped) suite value.
 * @param source An optional source label (e.g. a file path) for error messages.
 * @returns The validated suite.
 * @throws {SuiteValidationError} If the value does not satisfy the schema.
 */
export function validateSuite(raw: unknown, source?: string): Suite {
  const result = getValidator().validate(raw);
  if (!result.valid) {
    throw new SuiteValidationError(
      result.errors as RawValidationError[],
      source,
    );
  }
  return raw as unknown as Suite;
}
