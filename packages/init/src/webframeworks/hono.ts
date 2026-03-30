import { pipe } from "@fxts/core";
import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { replace } from "../utils.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, packageManagerToRuntime } from "./utils.ts";

const honoDescription: WebFrameworkDescription = {
  label: "Hono",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 8000,
  init: async ({ projectName, packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@std/dotenv": deps["@std/dotenv"],
        "@hono/hono": deps["@hono/hono"],
        "@hongminhee/x-forwarded-fetch": deps["@hongminhee/x-forwarded-fetch"],
        "@fedify/hono": PACKAGE_VERSION,
      }
      : pm === "bun"
      ? {
        hono: deps["npm:hono"],
        "x-forwarded-fetch": deps["npm:x-forwarded-fetch"],
        "@fedify/hono": PACKAGE_VERSION,
      }
      : {
        "@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"],
        hono: deps["npm:hono"],
        "@hono/node-server": deps["npm:@hono/node-server"],
        tsx: deps["npm:tsx"],
        "x-forwarded-fetch": deps["npm:x-forwarded-fetch"],
        "@fedify/hono": PACKAGE_VERSION,
      },
    devDependencies: {
      ...defaultDevDependencies,
      ...(pm === "bun" ? { "@types/bun": deps["npm:@types/bun"] } : {}),
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/app.tsx": pipe(
        await readTemplate("hono/app.tsx"),
        replace(/\/\* hono \*\//, pm === "deno" ? "@hono/hono" : "hono"),
        replace(/\/\* logger \*\//, projectName),
      ),
      "src/index.ts": await readTemplate(
        `hono/index/${packageManagerToRuntime(pm)}.ts`,
      ),
      ...(pm !== "deno"
        ? {
          "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
        }
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
