import { pipe } from "@fxts/core";
import { replace } from "../utils.ts";
import { PACKAGE_MANAGER } from "./const.ts";
import {
  getInstruction,
  getNextInitCommand,
  getNitroInitCommand,
  PACKAGE_VERSION,
  packageManagerToRuntime,
  readTemplate,
} from "./lib.ts";
import type { WebFrameworks } from "./types.ts";

const webFrameworks: WebFrameworks = {
  hono: {
    label: "Hono",
    packageManagers: PACKAGE_MANAGER,
    init: ({ projectName, packageManager: pm }) => ({
      dependencies: pm === "deno"
        ? {
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
      devDependencies: pm === "bun" ? { "@types/bun": "^1.1.6" } : {},
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
      instruction: getInstruction(pm, 8000),
    }),
    defaultPort: 8000,
  },
  elysia: {
    label: "ElysiaJS",
    packageManagers: ["bun"],
    init: ({ projectName, packageManager: pm }) => ({
      dependencies: {
        elysia: "^1.3.6",
        "@fedify/elysia": PACKAGE_VERSION,
      },
      devDependencies: {
        "@types/bun": "^1.2.19",
      },
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      files: {
        "src/index.ts": readTemplate("elysia/index.ts")
          .replace(/\/\* logger \*\//, projectName),
      },
      compilerOptions: undefined,
      tasks: {
        "dev": "bun run --hot ./src/index.ts",
        "prod": "bun run ./src/index.ts",
      },
      instruction: getInstruction(pm, 3000),
    }),
    defaultPort: 3000,
  },
  express: {
    label: "Express",
    packageManagers: PACKAGE_MANAGER,
    init: ({ projectName, packageManager: pm }) => ({
      dependencies: {
        "npm:express": "^4.19.2",
        "@fedify/express": PACKAGE_VERSION,
        ...(pm !== "deno" && pm !== "bun"
          ? { "@dotenvx/dotenvx": "^1.14.1", tsx: "^4.17.0" }
          : {}),
      },
      devDependencies: {
        "@types/express": "^4.17.21",
        ...(pm === "bun" ? { "@types/bun": "^1.1.6" } : {}),
      },
      federationFile: "src/federation.ts",
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
          : pm === "deno"
          ? "deno run --allow-net --allow-env --allow-sys --watch ./src/index.ts"
          : "dotenvx run -- tsx watch ./src/index.ts",
        "prod": pm === "bun"
          ? "bun run ./src/index.ts"
          : pm === "deno"
          ? "deno run --allow-net --allow-env --allow-sys ./src/index.ts"
          : "dotenvx run -- node --import tsx ./src/index.ts",
      },
      instruction: getInstruction(pm, 8000),
    }),
    defaultPort: 8000,
  },
  nitro: {
    label: "Nitro",
    packageManagers: PACKAGE_MANAGER,
    init: ({ packageManager: pm, testMode }) => ({
      command: getNitroInitCommand(pm),
      dependencies: { "@fedify/h3": PACKAGE_VERSION },
      federationFile: "server/federation.ts",
      loggingFile: "server/logging.ts",
      files: {
        "server/middleware/federation.ts": readTemplate(
          "nitro/server/middleware/federation.ts",
        ),
        "server/error.ts": readTemplate("nitro/server/error.ts"),
        "nitro.config.ts": readTemplate("nitro/nitro.config.ts"),
        ...(
          testMode ? { ".env": readTemplate("nitro/.env.test") } : {}
        ),
      },
      instruction: getInstruction(pm, 3000),
    }),
    defaultPort: 3000,
  },
  next: {
    label: "Next.js",
    packageManagers: PACKAGE_MANAGER,
    init: ({ packageManager: pm }) => ({
      label: "Next.js",
      command: getNextInitCommand(pm),
      dependencies: { "@fedify/next": PACKAGE_VERSION },
      devDependencies: { "@types/node": "^20.11.2" },
      federationFile: "federation/index.ts",
      loggingFile: "logging.ts",
      files: { "middleware.ts": readTemplate("next/middleware.ts") },
      instruction: getInstruction(pm, 3000),
    }),
    defaultPort: 3000,
  },
} as const;
export default webFrameworks;
