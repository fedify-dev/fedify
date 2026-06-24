import {
  argument,
  command,
  constant,
  type InferValue,
  message,
  object,
  option,
  withDefault,
} from "@optique/core";
import { path } from "@optique/run";

const schemaDir = withDefault(
  option(
    "-i",
    "--input",
    path({ metavar: "DIR", type: "directory", mustExist: true }),
    { description: message`Directory containing schema files.` },
  ),
  ".",
);
const generatedPath = argument(
  path({ metavar: "PATH", type: "file", allowCreate: true }),
  {
    description:
      message`Path to output the generated vocabulary classes.  Should end with ${".ts"} suffix.`,
  },
);

export const generateVocabOptions = object("Generation options", {
  command: constant("generate-vocab"),
  schemaDir,
  generatedPath,
});

export const generateVocabMetadata = {
  description: message`Generate vocabulary classes from schema files.`,
};

const generateVocabCommand = command(
  "generate-vocab",
  generateVocabOptions,
  generateVocabMetadata,
);

export default generateVocabCommand;

export type GenerateVocabCommand = InferValue<typeof generateVocabCommand>;
