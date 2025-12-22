import { generateVocab } from "@fedify/vocab-tools";
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

async function codegen() {
  const scriptsDir = import.meta.dirname;
  if (!scriptsDir) {
    throw new Error("Could not determine schema directory");
  }
  const schemaDir = join(dirname(scriptsDir), "src", "vocab");
  const generatedPath = join(schemaDir, `vocab-${crypto.randomUUID()}.ts`);
  const realDir = join(scriptsDir, "..", "..", "vocab", "src");
  const realPath = join(realDir, "mod.ts");

  await mkdir(realDir, { recursive: true });
  await generateVocab(schemaDir, generatedPath);
  await rename(generatedPath, realPath);
}

if (import.meta.main) {
  await codegen();
}
