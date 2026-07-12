import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies } from "./const.ts";
import { getInstruction, pmToRt } from "./utils.ts";

const astroNodeBunDevDependencies = {
  "@fedify/lint": PACKAGE_VERSION,
  "oxlint": deps["npm:oxlint"],
  "prettier": deps["npm:prettier"],
  "prettier-plugin-astro": deps["npm:prettier-plugin-astro"],
};

const astroNodeBunDevToolTasks = {
  format: "prettier --plugin prettier-plugin-astro --write .",
  "format:check": "prettier --plugin prettier-plugin-astro --check .",
  lint: "oxlint .",
} as const;

const ASTRO_NODE_VERSION_CHECK = `
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error("Astro 7 requires Node.js 22.12 or later.");
  process.exit(1);
}
`.trim();

const astroDescription: WebFrameworkDescription = {
  label: "Astro",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 4321,
  init: async ({ packageManager: pm }) => {
    // Astro loads integrations and middleware through Vite.  Vite resolves
    // bare imports from node_modules rather than Deno's JSR import map, so
    // keep Vite-loaded dependencies on npm even though @fedify/astro is also
    // published on JSR.
    const dependencies: Record<string, string> = pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@fedify/fedify": `npm:@fedify/fedify@${PACKAGE_VERSION}`,
        "@fedify/vocab": `npm:@fedify/vocab@${PACKAGE_VERSION}`,
        "@logtape/logtape": `npm:@logtape/logtape@${deps["@logtape/logtape"]}`,
        astro: `npm:astro@${deps["npm:astro"]}`,
        "@deno/astro-adapter": `npm:@deno/astro-adapter@${
          deps["npm:@deno/astro-adapter"]
        }`,
        "@fedify/astro": `npm:@fedify/astro@${PACKAGE_VERSION}`,
      }
      : pm === "bun"
      ? {
        "@astrojs/node": deps["npm:@astrojs/node"],
        "@fedify/astro": PACKAGE_VERSION,
        astro: deps["npm:astro"],
      }
      : {
        "@astrojs/node": deps["npm:@astrojs/node"],
        "@fedify/astro": PACKAGE_VERSION,
        "@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"],
        astro: deps["npm:astro"],
      };

    return {
      command: Array.from(getAstroInitCommand(pm)),
      dependencies,
      devDependencies: {
        ...(pm === "deno" ? {} : astroNodeBunDevDependencies),
        ...(pm !== "deno"
          ? {
            typescript: deps["npm:typescript"],
            "@types/node": deps["npm:@types/node@22"],
          }
          : {}),
      },
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      format: pm === "deno" ? undefined : { tool: "prettier" },
      files: {
        "astro.config.ts": await readTemplate(
          `astro/astro.config.${pmToRt(pm)}.ts`,
        ),
        "src/middleware.ts": await readTemplate("astro/src/middleware.ts"),
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
  if (pm !== "deno" && pm !== "bun") {
    yield "node";
    yield "-e";
    yield ASTRO_NODE_VERSION_CHECK;
    yield "&&";
  }
  yield* createAstroAppCommand(pm);
  yield `astro@${deps["npm:create-astro"]}`;
  yield ".";
  yield "--";
  yield "--no-git";
  yield "--skip-houston";
  yield "-y";
  yield "--ref";
  yield `astro@${deps["npm:astro"].replace(/^\D+/, "")}`;
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
    ...astroNodeBunDevToolTasks,
  },
  "node": {
    dev: "dotenvx run -- astro dev",
    build: "dotenvx run -- astro build",
    preview: "dotenvx run -- astro preview",
    ...astroNodeBunDevToolTasks,
  },
};
