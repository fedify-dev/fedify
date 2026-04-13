import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction } from "./utils.ts";

const nuxtDescription: WebFrameworkDescription = {
  label: "Nuxt",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: async ({ packageManager: pm, testMode }) => ({
    command: Array.from(getInitCommand(pm)),
    dependencies: getDeps(pm),
    devDependencies: {
      ...defaultDevDependencies,
      "typescript": deps["npm:typescript"],
      "@types/node": deps["npm:@types/node@25"],
    },
    federationFile: "server/federation.ts",
    loggingFile: "server/logging.ts",
    env: testMode ? { HOST: "127.0.0.1" } : {} as Record<string, string>,
    files: {
      "nuxt.config.ts": await readTemplate("nuxt/nuxt.config.ts"),
      ...(pm !== "deno" && {
        "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
      }),
    },
    tasks: pm !== "deno"
      ? { "lint": "eslint ." }
      : {} as Record<string, string>,
    instruction: getInstruction(pm, 3000),
  }),
};

export default nuxtDescription;

function* getInitCommand(pm: PackageManager) {
  yield* getNuxtInitCommand(pm);
  yield* [
    "init",
    ".",
    "--template",
    "minimal",
    "--no-install",
    "--force",
    "--packageManager",
    pm,
    "--no-gitInit",
    "--no-modules",
    "&&",
    "rm",
    "nuxt.config.ts",
  ];
}

/**
 * Returns the shell command array to scaffold a new Nuxt project
 * in the current directory using the given package manager.
 */
const getNuxtInitCommand = (pm: PackageManager): string[] =>
  pm === "bun"
    ? ["bunx", "nuxi"]
    : pm === "deno"
    ? ["deno", "-A", "npm:nuxi@latest"]
    : pm === "npm"
    ? ["npx", "nuxi"]
    : [pm, "dlx", "nuxi"];

const getDeps = (pm: PackageManager): Record<string, string> =>
  pm !== "deno"
    ? {
      "@fedify/nuxt": PACKAGE_VERSION,
    }
    : {
      ...defaultDenoDependencies,
      "@fedify/nuxt": PACKAGE_VERSION,
    };
