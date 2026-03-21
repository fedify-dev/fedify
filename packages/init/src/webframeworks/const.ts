import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION } from "../lib.ts";

export const defaultDevDependencies = {
  "@fedify/lint": PACKAGE_VERSION,
  "eslint": deps["npm:eslint"],
  "@biomejs/biome": deps["npm:@biomejs/biome"],
};

export const defaultDenoDependencies = {
  "@fedify/lint": PACKAGE_VERSION,
};
