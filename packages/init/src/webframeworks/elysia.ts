import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, packageManagerToRuntime } from "./utils.ts";

const elysiaDescription: WebFrameworkDescription = {
  label: "ElysiaJS",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: ({ projectName, packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        elysia: "npm:elysia@^1.3.6",
        "@fedify/elysia": PACKAGE_VERSION,
      }
      : pm === "bun"
      ? {
        elysia: "^1.3.6",
        "@fedify/elysia": PACKAGE_VERSION,
      }
      : {
        elysia: "^1.3.6",
        "@elysiajs/node": "^1.4.2",
        "@fedify/elysia": PACKAGE_VERSION,
        ...(pm === "pnpm"
          ? {
            "@sinclair/typebox": "^0.34.41",
            "openapi-types": "^12.1.3",
          }
          : {}),
      },
    devDependencies: {
      ...(pm === "bun" ? { "@types/bun": "^1.2.19" } : {
        tsx: "^4.21.0",
        "@types/node": "^25.0.3",
        typescript: "^5.9.3",
      }),
      ...defaultDevDependencies,
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/index.ts": readTemplate(
        `elysia/index/${packageManagerToRuntime(pm)}.ts`,
      ).replace(/\/\* logger \*\//, projectName),
      ...(pm !== "deno"
        ? { "eslint.config.ts": readTemplate("defaults/eslint.config.ts") }
        : {}),
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
    tasks: {
      "dev": pm === "deno"
        ? "deno serve --allow-env --allow-net --watch ./src/index.ts"
        : pm === "bun"
        ? "bun run --hot ./src/index.ts"
        : "tsx watch src/index.ts",
      ...(pm === "deno"
        ? { "prod": "deno serve --allow-env --allow-net ./src/index.ts" }
        : pm === "bun"
        ? { "prod": "bun run ./src/index.ts" }
        : {
          "build": "tsc src/index.ts --outDir dist",
          "start": "NODE_ENV=production node dist/index.js",
        }),
      ...(pm !== "deno" ? { "lint": "eslint ." } : {}),
    },
    instruction: getInstruction(pm, 3000),
  }),
};

export default elysiaDescription;
