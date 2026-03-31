import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, pmToRt } from "./utils.ts";

const bareBonesDescription: WebFrameworkDescription = {
  label: "Bare-bones",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 8000,
  init: async ({ packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@std/dotenv": deps["@std/dotenv"],
        "@hongminhee/x-forwarded-fetch": deps["@hongminhee/x-forwarded-fetch"],
      }
      : pm === "bun"
      ? { "npm:x-forwarded-fetch": deps["npm:x-forwarded-fetch"] }
      : {
        "npm:@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"],
        "npm:@hono/node-server": deps["npm:@hono/node-server"],
        "npm:tsx": deps["npm:tsx"],
        "npm:x-forwarded-fetch": deps["npm:x-forwarded-fetch"],
      },
    devDependencies: {
      ...defaultDevDependencies,
      ...(pm === "bun"
        ? { "@types/bun": deps["npm:@types/bun"] }
        : { "@types/node": deps["npm:@types/node@25"] }),
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/main.ts": await readTemplate(
        `bare-bones/main/${pmToRt(pm)}.ts`,
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
    tasks: TASKS[pmToRt(pm)],
    instruction: getInstruction(pm, 8000),
  }),
};

export default bareBonesDescription;

const TASKS = {
  deno: {
    dev: "deno run -A --watch ./src/main.ts",
    prod: "deno run -A ./src/main.ts",
  },
  bun: {
    dev: "bun run --hot ./src/main.ts",
    prod: "bun run ./src/main.ts",
  },
  node: {
    dev: "dotenvx run -- tsx watch ./src/main.ts",
    prod: "dotenvx run -- node --import tsx ./src/main.ts",
  },
};
