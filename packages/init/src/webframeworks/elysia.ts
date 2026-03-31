import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, pmToRt } from "./utils.ts";

const elysiaDescription: WebFrameworkDescription = {
  label: "ElysiaJS",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: async ({ projectName, packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        elysia: `npm:elysia@${deps["npm:elysia"]}`,
        "@fedify/elysia": PACKAGE_VERSION,
      }
      : pm === "bun"
      ? {
        elysia: deps["npm:elysia"],
        "@fedify/elysia": PACKAGE_VERSION,
      }
      : {
        "@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"],
        elysia: deps["npm:elysia"],
        "@elysiajs/node": deps["npm:@elysiajs/node"],
        "@fedify/elysia": PACKAGE_VERSION,
        ...(pm === "pnpm" && {
          "@sinclair/typebox": deps["npm:@sinclair/typebox"],
          "openapi-types": deps["npm:openapi-types"],
        }),
      },
    devDependencies: {
      ...(pm === "bun" ? { "@types/bun": deps["npm:@types/bun"] } : {
        tsx: deps["npm:tsx"],
        "@types/node": deps["npm:@types/node@25"],
        typescript: deps["npm:typescript"],
      }),
      ...defaultDevDependencies,
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/index.ts": (await readTemplate(
        `elysia/index/${pmToRt(pm)}.ts`,
      )).replace(/\/\* logger \*\//, projectName),
      ...(pm !== "deno" && {
        "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
      }),
    },
    compilerOptions: pm === "deno" || pm === "bun" ? undefined : {
      "lib": ["ESNext", "DOM"],
      "target": "ESNext",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "allowImportingTsExtensions": true,
      "verbatimModuleSyntax": true,
      "noEmit": true,
      "strict": true,
    },
    tasks: TASKS[pmToRt(pm)],
    instruction: getInstruction(pm, 3000),
  }),
};

export default elysiaDescription;

const TASKS = {
  deno: {
    dev:
      "deno serve --allow-read --allow-env --allow-net --watch ./src/index.ts",
    prod: "deno serve --allow-read --allow-env --allow-net ./src/index.ts",
  },
  bun: {
    dev: "bun run --hot ./src/index.ts",
    prod: "bun run ./src/index.ts",
    lint: "eslint .",
  },
  node: {
    dev: "dotenvx run -- tsx watch src/index.ts",
    build: "tsc src/index.ts --outDir dist",
    start: "NODE_ENV=production node dist/index.js",
    lint: "eslint .",
  },
};
