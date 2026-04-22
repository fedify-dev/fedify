import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, pmToRt } from "./utils.ts";

const astroDescription: WebFrameworkDescription = {
  label: "Astro",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 4321,
  init: async ({ packageManager: pm }) => {
    const dependencies: Record<string, string> = pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@deno/astro-adapter": `npm:@deno/astro-adapter@${
          deps["npm:@deno/astro-adapter"]
        }`,
        "@fedify/astro": PACKAGE_VERSION,
      }
      : pm === "bun"
      ? {
        "@fedify/astro": PACKAGE_VERSION,
        "@nurodev/astro-bun": deps["npm:@nurodev/astro-bun"],
      }
      : {
        "@astrojs/node": deps["npm:@astrojs/node"],
        "@fedify/astro": PACKAGE_VERSION,
        "@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"],
      };

    return {
      command: Array.from(getAstroInitCommand(pm)),
      dependencies,
      devDependencies: {
        ...defaultDevDependencies,
        ...(pm !== "deno"
          ? {
            typescript: deps["npm:typescript"],
            "@types/node": deps["npm:@types/node@22"],
          }
          : {}),
      },
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      files: {
        "astro.config.ts": await readTemplate(
          `astro/astro.config.${pmToRt(pm)}.ts`,
        ),
        "src/middleware.ts": await readTemplate("astro/src/middleware.ts"),
        ...(pm !== "deno" && {
          "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
        }),
      },
      tasks: TASKS[pmToRt(pm)],
      instruction: getInstruction(pm, 4321),
    };
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
  if (pm !== "deno") yield "--no-install";
  yield "&&";
  yield "rm";
  yield "astro.config.mjs";
  if (pm === "deno") yield "package.json";
}

const createAstroAppCommand = (pm: PackageManager): string[] =>
  pm === "deno" ? ["deno", "init", "-y", "--npm"] : [pm, "create"];

const TASKS = {
  "deno": {
    dev: "deno run -A npm:astro dev",
    build: "deno run -A npm:astro build",
    preview: "deno run -A npm:astro preview",
  },
  "bun": {
    dev: "bunx --bun astro dev",
    build: "bunx --bun astro build",
    preview: "bun ./dist/server/entry.mjs",
    lint: "eslint .",
  },
  "node": {
    dev: "dotenvx run -- astro dev",
    build: "dotenvx run -- astro build",
    preview: "dotenvx run -- astro preview",
    lint: "eslint .",
  },
};
