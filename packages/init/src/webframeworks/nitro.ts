import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, getNodeBunDevToolTasks } from "./utils.ts";

const nitroDescription: WebFrameworkDescription = {
  label: "Nitro",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: async ({ packageManager: pm, testMode }) => ({
    command: getNitroInitCommand(pm),
    cleanupFiles: pm === "deno" ? [] : ["server/routes/index.ts"],
    cleanupPackageJson: pm === "deno" ? {} : {
      devDependencies: ["eslint", "eslint-config-unjs", "prettier"],
    },
    dependencies: {
      "@fedify/h3": PACKAGE_VERSION,
      ...(pm === "deno" && defaultDenoDependencies),
    },
    devDependencies: defaultDevDependencies,
    federationFile: "server/federation.ts",
    loggingFile: "server/logging.ts",
    format: {
      ignorePatterns: [".output/**"],
    },
    env: testMode ? { HOST: "127.0.0.1" } : {} as Record<string, string>,
    files: {
      "server/plugins/logging.ts": await readTemplate(
        "nitro/server/plugins/logging.ts",
      ),
      "server/middleware/federation.ts": await readTemplate(
        "nitro/server/middleware/federation.ts",
      ),
      "server/error.ts": await readTemplate("nitro/server/error.ts"),
      "nitro.config.ts": await readTemplate("nitro/nitro.config.ts"),
      ...(pm === "deno" ? {} : {
        "server/routes/index.ts": await readTemplate(
          "nitro/server/routes/index.ts",
        ),
      }),
    },
    compilerOptions: pm === "deno" ? undefined : {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "preserve",
      jsxFactory: "h",
      jsxFragmentFactory: "Fragment",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      allowSyntheticDefaultImports: true,
      forceConsistentCasingInFileNames: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      useUnknownInCatchVariables: true,
      noUnusedLocals: true,
      lib: ["ESNext", "DOM"],
      baseUrl: ".",
    },
    tasks: getNodeBunDevToolTasks(pm),
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
