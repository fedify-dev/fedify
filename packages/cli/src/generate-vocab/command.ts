import {
  command,
  constant,
  type InferValue,
  message,
  object,
  option,
} from "@optique/core";
import { path } from "@optique/run";

const schemaDir = option(
  "-i",
  "--input",
  path({ metavar: "DIR" }),
);
const generatedPath = option(
  "-o",
  "--output",
  path({ metavar: "PATH" }),
);

const generateVocabCommand = command(
  "generate-vocab",
  object({
    command: constant("generate-vocab"),
    schemaDir,
    generatedPath,
  }),
  {
    description: message`Generate Vocabulary Classes from Schema Files`,
  },
);

export default generateVocabCommand;

export type GenerateVocabCommand = InferValue<typeof generateVocabCommand>;
