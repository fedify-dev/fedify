import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDevDependencies } from "./const.ts";
import { getInstruction, pmToRt } from "./utils.ts";

const adonisDescription: WebFrameworkDescription = {
  label: "AdonisJS",
  packageManagers: ["pnpm", "bun", "yarn", "npm"],
  defaultPort: 3333,
  init: async ({ projectName, packageManager: pm }) => ({
    dependencies: {
      "@adonisjs/core": deps["npm:@adonisjs/core"],
      "@fedify/adonis": PACKAGE_VERSION,
      ...(pmToRt(pm) === "node" && {
        "@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"],
        tsx: deps["npm:tsx"],
      }),
    },
    devDependencies: {
      ...(pm === "bun"
        ? { "@types/bun": deps["npm:@types/bun"] }
        : { "@types/node": deps["npm:@types/node@22"] }),
      ...defaultDevDependencies,
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/app.ts": (await readTemplate("adonis/app.ts"))
        .replace(/\/\* logger \*\//, projectName),
      "src/index.ts": await readTemplate("adonis/index.ts"),
      "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
    },
    compilerOptions: {
      "lib": ["ESNext"],
      "target": "ESNext",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "allowImportingTsExtensions": true,
      "verbatimModuleSyntax": true,
      "noEmit": true,
      "strict": true,
    },
    tasks: TASKS[pmToRt(pm)],
    instruction: getInstruction(pm, 3333),
  }),
};

export default adonisDescription;

const TASKS: Record<"deno" | "bun" | "node", Record<string, string>> = {
  deno: {
    dev: "deno run -A --watch ./src/index.ts",
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
