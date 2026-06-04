/**
 * Regenerates the published benchmark JSON Schema files under the repository's
 * *schema/bench/* directory from the embedded schema objects.
 *
 * The embedded objects (under *packages/cli/src/bench/.../schema.ts*) are the
 * editing source; the published *.json* files are the hosted copies.  A drift
 * guard keeps the two identical, so run this script after editing an embedded
 * schema.
 *
 * Usage: `deno run -A scripts/generate-bench-schema.ts`
 * @module
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PUBLISHED_SCHEMAS } from "../src/bench/schemas.ts";
import { SCHEMA_DIR, serializeSchema } from "../src/bench/schema-paths.ts";

async function main(): Promise<void> {
  await mkdir(SCHEMA_DIR, { recursive: true });
  for (const { fileName, schema } of PUBLISHED_SCHEMAS) {
    const path = join(SCHEMA_DIR, fileName);
    await writeFile(path, serializeSchema(schema), { encoding: "utf-8" });
    console.error(`Wrote ${path}`);
  }
}

await main();
