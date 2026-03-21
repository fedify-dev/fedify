import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction } from "./utils.ts";

const expressDescription: WebFrameworkDescription = {
  label: "Express",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 8000,
  init: async ({ projectName, packageManager: pm }) => ({
    dependencies: {
      "npm:express": deps["npm:express"],
      "@fedify/express": PACKAGE_VERSION,
      ...(pm !== "deno" && pm !== "bun"
        ? {
          "@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"],
          tsx: deps["npm:tsx"],
        }
        : {}),
      ...(pm === "deno" ? defaultDenoDependencies : {}),
    },
    devDependencies: {
      "@types/express": deps["npm:@types/express"],
      ...(pm === "bun" ? { "@types/bun": deps["npm:@types/bun"] } : {}),
      ...defaultDevDependencies,
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/app.ts": (await readTemplate("express/app.ts"))
        .replace(/\/\* logger \*\//, projectName),
      "src/index.ts": await readTemplate("express/index.ts"),
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
    },
    tasks: {
      "dev": pm === "bun"
        ? "bun run --hot ./src/index.ts"
        : pm === "deno"
        ? "deno run --allow-net --allow-env --allow-sys --watch ./src/index.ts"
        : "dotenvx run -- tsx watch ./src/index.ts",
      "prod": pm === "bun"
        ? "bun run ./src/index.ts"
        : pm === "deno"
        ? "deno run --allow-net --allow-env --allow-sys ./src/index.ts"
        : "dotenvx run -- node --import tsx ./src/index.ts",
      ...(pm !== "deno" ? { "lint": "eslint ." } : {}),
    },
    instruction: getInstruction(pm, 8000),
  }),
};

export default expressDescription;
