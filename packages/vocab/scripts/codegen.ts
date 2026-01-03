import { generateVocab } from "@fedify/vocab-tools";
import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";

async function codegen() {
  const scriptsDir = import.meta.dirname;
  if (!scriptsDir) {
    throw new Error("Could not determine schema directory");
  }
  const schemaDir = join(dirname(scriptsDir), "src");
  const generatedPath = join(schemaDir, `vocab-${crypto.randomUUID()}.ts`);
  const realPath = join(schemaDir, "vocab.ts");

  await generateVocab(schemaDir, generatedPath);
  await rename(generatedPath, realPath);
}

if (import.meta.main) {
  await codegen();
}
