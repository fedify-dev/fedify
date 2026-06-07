/**
 * The registry of published benchmark JSON Schemas.
 *
 * Each entry pairs the embedded runtime schema object with the file name it is
 * published under in the repository's *schema/bench/* directory.  The schema
 * guards (meta-schema, fixture, drift, and immutability) iterate over this
 * registry, so adding a new published schema automatically extends the guards.
 * @since 2.3.0
 * @module
 */

import { reportSchemaV1 } from "./result/schema.ts";
import { scenarioSchemaV1 } from "./scenario/schema.ts";

/** A published JSON Schema and where it is hosted. */
export interface PublishedSchema {
  /** A short identifier, e.g. `"scenario"`. */
  readonly name: string;
  /** The published file name under *schema/bench/*. */
  readonly fileName: string;
  /** The embedded runtime schema object. */
  readonly schema: Record<string, unknown>;
}

/** All benchmark schemas published to json-schema.fedify.dev. */
export const PUBLISHED_SCHEMAS: readonly PublishedSchema[] = [
  {
    name: "scenario",
    fileName: "scenario-v1.json",
    schema: scenarioSchemaV1 as unknown as Record<string, unknown>,
  },
  {
    name: "report",
    fileName: "report-v1.json",
    schema: reportSchemaV1 as unknown as Record<string, unknown>,
  },
];
