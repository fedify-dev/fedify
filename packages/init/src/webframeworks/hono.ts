import { pipe } from "@fxts/core";
import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { replace } from "../utils.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, packageManagerToRuntime } from "./utils.ts";

const honoDescription: WebFrameworkDescription = {
  label: "Hono",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 8000,
  init: ({ projectName, packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@std/dotenv": "^0.225.2",
        "@hono/hono": "^4.5.0",
        "@hongminhee/x-forwarded-fetch": "^0.2.0",
        "@fedify/hono": PACKAGE_VERSION,
      }
      : pm === "bun"
      ? {
        hono: "^4.5.0",
        "x-forwarded-fetch": "^0.2.0",
        "@fedify/hono": PACKAGE_VERSION,
      }
      : {
        "@dotenvx/dotenvx": "^1.14.1",
        hono: "^4.5.0",
        "@hono/node-server": "^1.12.0",
        tsx: "^4.17.0",
        "x-forwarded-fetch": "^0.2.0",
        "@fedify/hono": PACKAGE_VERSION,
      },
    devDependencies: {
      ...defaultDevDependencies,
      ...(pm === "bun" ? { "@types/bun": "^1.1.6" } : {}),
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/app.tsx": pipe(
        "hono/app.tsx",
        readTemplate,
        replace(/\/\* hono \*\//, pm === "deno" ? "@hono/hono" : "hono"),
        replace(/\/\* logger \*\//, projectName),
      ),
      "src/index.ts": readTemplate(
        `hono/index/${packageManagerToRuntime(pm)}.ts`,
      ),
      ...(pm !== "deno"
        ? { "eslint.config.ts": readTemplate("defaults/eslint.config.ts") }
        : {}),
    },
    compilerOptions: pm === "deno" ? undefined : {
      "lib": ["ESNext", "DOM"],
      "target": "ESNext",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "allowImportingTsExtensions": true,
      "verbatimModuleSyntax": true,
      "noEmit": true,
      "strict": true,
      "jsx": "react-jsx",
      "jsxImportSource": "hono/jsx",
    },
    tasks: {
      "dev": pm === "deno"
        ? "deno run -A --watch ./src/index.ts"
        : pm === "bun"
        ? "bun run --hot ./src/index.ts"
        : "dotenvx run -- tsx watch ./src/index.ts",
      "prod": pm === "deno"
        ? "deno run -A ./src/index.ts"
        : pm === "bun"
        ? "bun run ./src/index.ts"
        : "dotenvx run -- node --import tsx ./src/index.ts",
      ...(pm !== "deno" ? { "lint": "eslint ." } : {}),
    },
    instruction: getInstruction(pm, 8000),
  }),
};

export default honoDescription;
