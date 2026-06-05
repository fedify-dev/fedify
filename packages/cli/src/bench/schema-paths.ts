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

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `import.meta.dirname` is only available on Node >= 20.11, but this package
// supports Node >= 20.0, so derive the directory from the module URL instead.
const here = dirname(fileURLToPath(import.meta.url));

/** The absolute path to the repository's *schema/bench/* directory. */
export const SCHEMA_DIR: string = join(
  here,
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
