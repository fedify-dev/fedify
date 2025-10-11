import { generateVocab } from "@fedify/vocab-tools";
import { message } from "@optique/core/message";
import { printError } from "@optique/run";
import { stat } from "node:fs/promises";
import process from "node:process";
import type { GenerateVocabCommand } from "./command.ts";

export default async function runGenerateVocab(
  { schemaPath, generatedPath }: GenerateVocabCommand,
) {
  if (!(await stat(schemaPath)).isDirectory()) {
    printError(message`${schemaPath} is not a directory.`);
    process.exit(1);
  }

  await generateVocab(schemaPath, generatedPath);
}
