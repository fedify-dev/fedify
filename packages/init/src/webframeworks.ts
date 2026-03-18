import { pipe } from "@fxts/core";
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
import { replace } from "./utils.ts";

const webFrameworks: WebFrameworks = {
  bareBones: {
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
  },
  hono: {
    label: "Hono",
    packageManagers: PACKAGE_MANAGER,
    init: async ({ projectName, packageManager: pm }) => ({
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
    defaultPort: 8000,
  },
  elysia: {
    label: "ElysiaJS",
    packageManagers: PACKAGE_MANAGER,
    init: async ({ projectName, packageManager: pm }) => ({
      dependencies: pm === "deno"
        ? {
          ...defaultDenoDependencies,
          elysia: "npm:elysia@^1.3.6",
          "@fedify/elysia": PACKAGE_VERSION,
        }
        : pm === "bun"
        ? {
          elysia: "^1.3.6",
          "@fedify/elysia": PACKAGE_VERSION,
        }
        : {
          elysia: "^1.3.6",
          "@elysiajs/node": "^1.4.2",
          "@fedify/elysia": PACKAGE_VERSION,
          ...(pm === "pnpm"
            ? {
              "@sinclair/typebox": "^0.34.41",
              "openapi-types": "^12.1.3",
            }
            : {}),
        },
      devDependencies: {
        ...(pm === "bun" ? { "@types/bun": "^1.2.19" } : {
          tsx: "^4.21.0",
          "@types/node": "^25.0.3",
          typescript: "^5.9.3",
        }),
        ...defaultDevDependencies,
      },
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      files: {
        "src/index.ts": (await readTemplate(
          `elysia/index/${packageManagerToRuntime(pm)}.ts`,
        )).replace(/\/\* logger \*\//, projectName),
        ...(pm !== "deno"
          ? {
            "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
          }
          : {}),
      },
      compilerOptions: pm === "deno" || pm === "bun" ? undefined : {
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
        "dev": pm === "deno"
          ? "deno serve --allow-env --allow-net --watch ./src/index.ts"
          : pm === "bun"
          ? "bun run --hot ./src/index.ts"
          : "tsx watch src/index.ts",
        ...(pm === "deno"
          ? { "prod": "deno serve --allow-env --allow-net ./src/index.ts" }
          : pm === "bun"
          ? { "prod": "bun run ./src/index.ts" }
          : {
            "build": "tsc src/index.ts --outDir dist",
            "start": "NODE_ENV=production node dist/index.js",
          }),
        ...(pm !== "deno" ? { "lint": "eslint ." } : {}),
      },
      instruction: getInstruction(pm, 3000),
    }),
    defaultPort: 3000,
  },
  express: {
    label: "Express",
    packageManagers: PACKAGE_MANAGER,
    init: async ({ projectName, packageManager: pm }) => ({
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
    defaultPort: 8000,
  },
  nitro: {
    label: "Nitro",
    packageManagers: PACKAGE_MANAGER,
    init: async ({ packageManager: pm, testMode }) => ({
      command: getNitroInitCommand(pm),
      dependencies: {
        "@fedify/h3": PACKAGE_VERSION,
        ...(pm === "deno" ? defaultDenoDependencies : {}),
      },
      devDependencies: defaultDevDependencies,
      federationFile: "server/federation.ts",
      loggingFile: "server/logging.ts",
      files: {
        "server/middleware/federation.ts": await readTemplate(
          "nitro/server/middleware/federation.ts",
        ),
        "server/error.ts": await readTemplate("nitro/server/error.ts"),
        "nitro.config.ts": await readTemplate("nitro/nitro.config.ts"),
        ...(
          testMode ? { ".env": await readTemplate("nitro/.env.test") } : {}
        ),
        ...(pm !== "deno"
          ? {
            "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
          }
          : {}),
      },
      tasks: {
        ...(pm !== "deno" ? { "lint": "eslint ." } : {}),
      },
      instruction: getInstruction(pm, 3000),
    }),
    defaultPort: 3000,
  },
  next: {
    label: "Next.js",
    packageManagers: PACKAGE_MANAGER,
    init: async ({ packageManager: pm }) => ({
      label: "Next.js",
      command: getNextInitCommand(pm),
      dependencies: {
        "@fedify/next": PACKAGE_VERSION,
        ...(pm === "deno" ? defaultDenoDependencies : {}),
      },
      devDependencies: {
        "@types/node": "^20.11.2",
        ...defaultDevDependencies,
      },
      federationFile: "federation/index.ts",
      loggingFile: "logging.ts",
      files: {
        "middleware.ts": await readTemplate("next/middleware.ts"),
        ...(pm !== "deno"
          ? {
            "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
          }
          : {}),
      },
      tasks: {
        ...(pm !== "deno" ? { "lint": "eslint ." } : {}),
      },
      instruction: getInstruction(pm, 3000),
    }),
    defaultPort: 3000,
  },
};
export default webFrameworks;

const defaultDevDependencies = {
  "eslint": "^9.0.0",
  "@fedify/lint": PACKAGE_VERSION,
};

const defaultDenoDependencies = {
  "@fedify/lint": PACKAGE_VERSION,
};
