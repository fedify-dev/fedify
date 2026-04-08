import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { getInstruction } from "./utils.ts";

const SUPPORTED_PACKAGE_MANAGERS = [
  "pnpm",
  "bun",
  "yarn",
  "npm",
] as const satisfies readonly PackageManager[];

const nuxtDescription: WebFrameworkDescription = {
  label: "Nuxt",
  packageManagers: SUPPORTED_PACKAGE_MANAGERS,
  defaultPort: 3000,
  init: async ({ packageManager: pm }) => ({
    command: getNuxtInitCommand(pm),
    dependencies: {
      "@fedify/nuxt": PACKAGE_VERSION,
    },
    federationFile: "server/federation.ts",
    loggingFile: "server/logging.ts",
    files: {
      "nuxt.config.ts": await readTemplate("nuxt/nuxt.config.ts"),
      "server/error.ts": await readTemplate("nuxt/server/error.ts"),
      "server/middleware/federation.ts": await readTemplate(
        "nuxt/server/middleware/federation.ts",
      ),
    },
    instruction: getInstruction(pm, 3000),
  }),
};

export default nuxtDescription;

const getNuxtInitCommand = (pm: PackageManager): string[] => [
  "env",
  "CI=1",
  ...createNuxtAppCommand(pm),
  ".",
  "--template",
  "minimal",
  "--force",
  "--no-install",
  "--packageManager",
  pm,
  "--gitInit=false",
  "&&",
  "rm",
  "nuxt.config.ts",
];

const createNuxtAppCommand = (pm: PackageManager): string[] =>
  pm === "bun"
    ? ["bunx", "nuxi@latest", "init"]
    : pm === "npm"
    ? ["npx", "nuxi@latest", "init"]
    : pm === "pnpm"
    ? ["pnpm", "dlx", "nuxi@latest", "init"]
    : ["yarn", "dlx", "nuxi@latest", "init"];
