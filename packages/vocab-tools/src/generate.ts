import { open } from "node:fs/promises";
import { generateClasses } from "./class.ts";
import { loadSchemaFiles } from "./schema.ts";

export default async function generateVocab(
  schemaDir: string,
  generatedPath: string,
): Promise<void> {
  const types = await loadSchemaFiles(schemaDir);
  const encoder = new TextEncoder();

  const file = await open(generatedPath, "w");
  const writer = file.createWriteStream();

  for await (const code of generateClasses(types)) {
    writer.write(encoder.encode(code));
  }

  await new Promise<void>((resolve, reject) => {
    writer.once("finish", () => file.close().then(resolve, reject));
    writer.once("error", reject);
    writer.end();
  });
}
