import { PACKAGE_VERSION } from "../lib.ts";

export const defaultDevDependencies = {
  "eslint": "^9.0.0",
  "@fedify/lint": PACKAGE_VERSION,
};

export const defaultDenoDependencies = {
  "@fedify/lint": PACKAGE_VERSION,
};
