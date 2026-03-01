import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction } from "./utils.ts";

const nextDescription: WebFrameworkDescription = {
  label: "Next.js",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: ({ packageManager: pm }) => ({
    command: getNextInitCommand(pm),
    dependencies: {
      "@fedify/next": PACKAGE_VERSION,
      ...(pm === "deno" ? defaultDenoDependencies : {}),
    },
    devDependencies: {
      "@types/node": "^20.11.2",
      ...defaultDevDependencies,
    },
    federationFile: "federation/index.ts",
    loggingFile: "logging.ts",
    files: {
      "middleware.ts": readTemplate("next/middleware.ts"),
      ...(pm !== "deno"
        ? { "eslint.config.ts": readTemplate("defaults/eslint.config.ts") }
        : {}),
    },
    tasks: {
      ...(pm !== "deno" ? { "lint": "eslint ." } : {}),
    },
    instruction: getInstruction(pm, 3000),
  }),
};

export default nextDescription;

/**
 * Returns the shell command array to scaffold a new Next.js project
 * in the current directory using the given package manager.
 */
const getNextInitCommand = (
  pm: PackageManager,
): string[] => [...createNextAppCommand(pm), ".", "--yes"];

const createNextAppCommand = (pm: PackageManager): string[] =>
  pm === "deno"
    ? ["deno", "-Ar", "npm:create-next-app@latest"]
    : pm === "bun"
    ? ["bun", "create", "next-app"]
    : pm === "npm"
    ? ["npx", "create-next-app"]
    : [pm, "dlx", "create-next-app"];
