/**
 * Shared path resolution and canonical serialization for the published
 * benchmark JSON Schema files.
 *
 * This module is used only by the schema generator script and the schema
 * guards (tests); it is never imported by the CLI runtime, which reads schemas
 * from the embedded objects rather than from disk.
 * @since 2.3.0
 * @module
 */

import { join } from "node:path";

/** The absolute path to the repository's *schema/bench/* directory. */
export const SCHEMA_DIR: string = join(
  import.meta.dirname!,
  "..",
  "..",
  "..",
  "..",
  "schema",
  "bench",
);

/**
 * Serializes a schema object to the canonical published form: pretty-printed
 * JSON with two-space indentation and a trailing newline.
 * @param schema The schema object to serialize.
 * @returns The canonical JSON text.
 */
export function serializeSchema(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
