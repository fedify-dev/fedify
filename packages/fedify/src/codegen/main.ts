import { generateClasses } from "./class.ts";
import { loadSchemaFiles } from "./schema.ts";

export async function main() {
  if (Deno.args.length != 3) {
    if (Deno.args.length < 3) {
      console.error("error: too few arguments");
    } else {
      console.error("error: too many arguments");
    }
    console.error(
      "usage: deno run",
      Deno.mainModule,
      "SCHEMA_DIR RUNTIME_PATH",
    );
    Deno.exit(1);
  }
  const schemaDir = Deno.args[0];
  const runtimePath = Deno.args[1];
  const outputPath = Deno.args[2];
  if (!(await Deno.stat(schemaDir)).isDirectory) {
    console.error("error:", schemaDir, "is not a directory");
    Deno.exit(1);
  }
  const types = await loadSchemaFiles(schemaDir);
  const encoder = new TextEncoder();

  using file = await Deno.open(outputPath, { write: true, create: true });
  const writer = file.writable.getWriter();

  for await (const code of generateClasses(types, runtimePath)) {
    await writer.write(encoder.encode(code));
  }
}

if (import.meta.main) {
  await main();
}
