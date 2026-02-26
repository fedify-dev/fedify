import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction } from "./utils.ts";

const expressDescription: WebFrameworkDescription = {
  label: "Express",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 8000,
  init: ({ projectName, packageManager: pm }) => ({
    dependencies: {
      "npm:express": "^4.19.2",
      "@fedify/express": PACKAGE_VERSION,
      ...(pm !== "deno" && pm !== "bun"
        ? { "@dotenvx/dotenvx": "^1.14.1", tsx: "^4.17.0" }
        : {}),
      ...(pm === "deno" ? defaultDenoDependencies : {}),
    },
    devDependencies: {
      "@types/express": "^4.17.21",
      ...(pm === "bun" ? { "@types/bun": "^1.1.6" } : {}),
      ...defaultDevDependencies,
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "src/app.ts": readTemplate("express/app.ts")
        .replace(/\/\* logger \*\//, projectName),
      "src/index.ts": readTemplate("express/index.ts"),
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
