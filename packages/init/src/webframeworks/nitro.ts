import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction } from "./utils.ts";

const nitroDescription: WebFrameworkDescription = {
  label: "Nitro",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: ({ packageManager: pm, testMode }) => ({
    command: getNitroInitCommand(pm),
    dependencies: {
      "@fedify/h3": PACKAGE_VERSION,
      ...(pm === "deno" ? defaultDenoDependencies : {}),
    },
    devDependencies: defaultDevDependencies,
    federationFile: "server/federation.ts",
    loggingFile: "server/logging.ts",
    files: {
      "server/middleware/federation.ts": readTemplate(
        "nitro/server/middleware/federation.ts",
      ),
      "server/error.ts": readTemplate("nitro/server/error.ts"),
      "nitro.config.ts": readTemplate("nitro/nitro.config.ts"),
      ...(
        testMode ? { ".env": readTemplate("nitro/.env.test") } : {}
      ),
      ...(pm !== "deno"
        ? { "eslint.config.ts": readTemplate("defaults/eslint.config.ts") }
        : {}),
    },
    tasks: pm !== "deno" ? { "lint": "eslint ." } : {} as { lint?: string },
    instruction: getInstruction(pm, 3000),
  }),
};

export default nitroDescription;

/**
 * Returns the shell command array to scaffold a new Nitro project
 * in the current directory using the given package manager.
 * Also removes the default `nitro.config.ts` so it can be replaced by a template.
 */
const getNitroInitCommand = (
  pm: PackageManager,
): string[] => [
  ...createNitroAppCommand(pm),
  pm === "deno" ? "npm:giget@latest" : "giget@latest",
  "nitro",
  ".",
  "&&",
  "rm",
  "nitro.config.ts", // Remove default nitro config file
  // This file will be created from template
];

const createNitroAppCommand = (pm: PackageManager): string[] =>
  pm === "deno"
    ? ["deno", "run", "-A"]
    : pm === "bun"
    ? ["bunx"]
    : pm === "npm"
    ? ["npx"]
    : [pm, "dlx"];
