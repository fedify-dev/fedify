import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, packageManagerToRuntime } from "./utils.ts";

const astroDescription: WebFrameworkDescription = {
  label: "Astro",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 4321,
  init: async ({ packageManager: pm }) => {
    const runtime = packageManagerToRuntime(pm);

    return ({
      command: Array.from(getAstroInitCommand(pm)),
      dependencies: pm === "deno"
        ? {
          ...defaultDenoDependencies,
          "@deno/astro-adapter": "npm:@deno/astro-adapter@^0.3.2",
          "@fedify/astro": PACKAGE_VERSION,
        }
        : pm === "bun"
        ? {
          "@fedify/astro": PACKAGE_VERSION,
          "@nurodev/astro-bun": "^2.1.2",
        }
        : {
          "@astrojs/node": "^9.5.4",
          "@fedify/astro": PACKAGE_VERSION,
        },
      devDependencies: {
        ...defaultDevDependencies,
        ...(pm !== "deno"
          ? { typescript: "^5.9.3", "@types/node": "^22.17.0" }
          : {}),
      },
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      files: {
        [`astro.config.ts`]: await readTemplate(
          `astro/astro.config.${runtime}.ts`,
        ),
        "src/middleware.ts": await readTemplate("astro/src/middleware.ts"),
        ...(pm !== "deno"
          ? {
            "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
          }
          : {}),
      },
      compilerOptions: undefined,
      tasks: {
        ...(pm === "deno"
          ? {
            dev: "deno run -A npm:astro dev",
            build: "deno run -A npm:astro build",
            preview: "deno run -A npm:astro preview",
          }
          : pm === "bun"
          ? {
            dev: "bunx --bun astro dev",
            build: "bunx --bun astro build",
            preview: "bun ./dist/server/entry.mjs",
          }
          : {
            dev: "astro dev",
            build: "astro build",
            preview: "astro preview",
          }),
        ...(pm !== "deno" ? { lint: "eslint ." } : {}),
      },
      instruction: getInstruction(pm, 4321),
    });
  },
};

export default astroDescription;

/**
 * Returns the shell command array to scaffold a new Astro project
 * in the current directory using the given package manager.
 * Also removes the default `astro.config.mjs` so it can be replaced
 * by a template.
 */
function* getAstroInitCommand(
  pm: PackageManager,
): Generator<string> {
  yield* createAstroAppCommand(pm);
  yield "astro@latest";
  yield ".";
  yield "--";
  yield "--no-git";
  yield "--skip-houston";
  yield "-y";
  yield "&&";
  yield "rm";
  yield "astro.config.mjs";
  if (pm === "deno") yield "package.json";
}

const createAstroAppCommand = (pm: PackageManager): string[] =>
  pm === "deno" ? ["deno", "init", "-y", "--npm"] : [pm, "create"];
