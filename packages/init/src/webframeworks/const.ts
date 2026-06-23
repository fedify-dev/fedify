import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION } from "../lib.ts";

export const defaultDevDependencies = {
  "@fedify/lint": PACKAGE_VERSION,
  "oxfmt": deps["npm:oxfmt"],
  "oxlint": deps["npm:oxlint"],
};

export const defaultDenoDependencies = {
  "@fedify/lint": PACKAGE_VERSION,
};
