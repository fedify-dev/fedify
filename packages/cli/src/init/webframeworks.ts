import { pipe } from "@fxts/core";
import { message } from "@optique/core";
import { replace } from "../utils.ts";
import { PACKAGE_MANAGER } from "./const.ts";
import {
  getInstruction,
  getNextInitCommand,
  getNitroInitCommand,
  PACKAGE_VERSION,
  readTemplate,
} from "./lib.ts";
import type { WebFrameworks } from "./types.ts";

const webFrameworks: WebFrameworks = {
  hono: {
    label: "Hono",
    packageManagers: PACKAGE_MANAGER,
    init: (projectName, pm) => ({
      dependencies: pm === "deno"
        ? {
          "@std/dotenv": "^0.225.2",
          "@hono/hono": "^4.5.0",
          "@hongminhee/x-forwarded-fetch": "^0.2.0",
        }
        : pm === "bun"
        ? { hono: "^4.5.0", "x-forwarded-fetch": "^0.2.0" }
        : {
          "@dotenvx/dotenvx": "^1.14.1",
          hono: "^4.5.0",
          "@hono/node-server": "^1.12.0",
          tsx: "^4.17.0",
          "x-forwarded-fetch": "^0.2.0",
        },
      devDependencies: pm === "bun" ? { "@types/bun": "^1.1.6" } : {},
      federationFile: message`src/federation.ts`,
      loggingFile: "src/logging.ts",
      files: {
        "src/app.tsx": pipe(
          "hono/app.tsx",
          readTemplate,
          replace(
            /\/\* hono \*\//,
            pm === "deno" ? "@hono/hono" : "hono",
          ),
        )
          .replace(/\/\* logger \*\//, projectName),
        "src/index.ts": readTemplate(`hono/index/${pm}.ts`),
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
      },
      instruction: getInstruction(pm),
    }),
  },
  express: {
    label: "Express",
    packageManagers: ["bun", "npm", "yarn", "pnpm"] as const,
    init: (projectName, pm) => ({
      dependencies: {
        express: "^4.19.2",
        "@fedify/express": PACKAGE_VERSION,
        ...(pm !== "deno" && pm !== "bun"
          ? { "@dotenvx/dotenvx": "^1.14.1", tsx: "^4.17.0" }
          : {}),
      },
      devDependencies: {
        "@types/express": "^4.17.21",
        ...(pm === "bun" ? { "@types/bun": "^1.1.6" } : {}),
      },
      federationFile: message`src/federation.ts`,
      loggingFile: "src/logging.ts",
      files: {
        "src/app.ts": readTemplate("express/app.ts")
          .replace(/\/\* logger \*\//, projectName),
        "src/index.ts": readTemplate("express/index.ts"),
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
          : "dotenvx run -- tsx watch ./src/index.ts",
        "prod": pm === "bun"
          ? "bun run ./src/index.ts"
          : "dotenvx run -- node --import tsx ./src/index.ts",
      },
      instruction: getInstruction(pm),
    }),
  },
  nitro: {
    label: "Nitro",
    packageManagers: PACKAGE_MANAGER,
    init: (_, pm) => ({
      command: getNitroInitCommand(pm),
      dependencies: { "@fedify/h3": PACKAGE_VERSION },
      federationFile: message`server/federation.ts`,
      loggingFile: "server/logging.ts",
      files: {
        "server/middleware/federation.ts": readTemplate(
          "nitro/server/middleware/federation.ts",
        ),
        "server/error.ts": readTemplate("nitro/server/error.ts"),
        "nitro.config.ts": readTemplate("nitro/nitro.config.ts"),
      },
      instruction: getInstruction(pm),
    }),
  },
  next: {
    label: "Next.js",
    packageManagers: PACKAGE_MANAGER,
    init: (_, pm) => ({
      label: "Next.js",
      command: getNextInitCommand(pm),
      dependencies: { "@fedify/next": PACKAGE_VERSION },
      devDependencies: { "@types/node": "^20.11.2" },
      federationFile: message`federation/index.ts`,
      loggingFile: "logging.ts",
      files: { "middleware.ts": readTemplate("next/middleware.ts") },
      instruction: getInstruction(pm),
    }),
  },
} as const;
export default webFrameworks;
