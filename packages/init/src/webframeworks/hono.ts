import { pipe } from "@fxts/core";
import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { replace } from "../utils.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, pmToRt } from "./utils.ts";

const honoDescription: WebFrameworkDescription = {
  label: "Hono",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 8000,
  init: async ({ projectName, packageManager: pm }) => ({
    dependencies: getDependencies(pm),
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
        `hono/index/${pmToRt(pm)}.ts`,
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
    tasks: TASKS[pmToRt(pm)],
    instruction: getInstruction(pm, 8000),
  }),
};

export default honoDescription;

const getDependencies = (pm: string): Record<string, string> =>
  pm === "deno"
    ? {
      ...defaultDenoDependencies,
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
    };

const TASKS = {
  deno: {
    dev: "deno run -A --watch ./src/index.ts",
    prod: "deno run -A ./src/index.ts",
  },
  bun: {
    dev: "bun run --hot ./src/index.ts",
    prod: "bun run ./src/index.ts",
    lint: "eslint .",
  },
  node: {
    dev: "dotenvx run -- tsx watch ./src/index.ts",
    prod: "dotenvx run -- node --import tsx ./src/index.ts",
    lint: "eslint .",
  },
};
