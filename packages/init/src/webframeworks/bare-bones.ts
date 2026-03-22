import { PACKAGE_MANAGER } from "../const.ts";
import { readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, packageManagerToRuntime } from "./utils.ts";

const bareBonesDescription: WebFrameworkDescription = {
  label: "Bare-bones",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 8000,
  init: async ({ packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@std/dotenv": "^0.225.2",
        "@hongminhee/x-forwarded-fetch": "^0.2.0",
      }
      : pm === "bun"
      ? { "npm:x-forwarded-fetch": "^0.2.0" }
      : {
        "npm:@dotenvx/dotenvx": "^1.14.1",
        "npm:@hono/node-server": "^1.12.0",
        "npm:tsx": "^4.17.0",
        "npm:x-forwarded-fetch": "^0.2.0",
      },
    devDependencies: {
      ...defaultDevDependencies,
      ...(pm === "bun"
        ? { "@types/bun": "^1.1.6" }
        : { "@types/node": "^18.0.0" }),
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/main.ts": await readTemplate(
        `bare-bones/main/${packageManagerToRuntime(pm)}.ts`,
      ),
      ...(pm !== "deno"
        ? {
          "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
        }
        : {}),
    },
    compilerOptions: (pm === "deno"
      ? {
        "jsx": "precompile",
        "jsxImportSource": "hono/jsx",
      }
      : {
        "lib": ["ESNext", "DOM"],
        "target": "ESNext",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "allowImportingTsExtensions": true,
        "verbatimModuleSyntax": true,
        "noEmit": true,
        "strict": true,
      }) as Record<string, string | boolean | number | string[] | null>,
    tasks: {
      "dev": pm === "deno"
        ? "deno run -A --watch ./src/main.ts"
        : pm === "bun"
        ? "bun run --hot ./src/main.ts"
        : "dotenvx run -- tsx watch ./src/main.ts",
      "prod": pm === "deno"
        ? "deno run -A ./src/main.ts"
        : pm === "bun"
        ? "bun run ./src/main.ts"
        : "dotenvx run -- node --import tsx ./src/main.ts",
    },
    instruction: getInstruction(pm, 8000),
  }),
};

export default bareBonesDescription;
