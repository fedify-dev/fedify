import { RUNTIME } from "./const.ts";
import {
  getInstruction,
  getNextInitCommand,
  PACKAGE_VERSION,
  readTemplate,
} from "./lib.ts";
import type { WebFrameworks } from "./types.ts";

const webFrameworks: WebFrameworks = {
  hono: {
    label: "Hono",
    runtimes: RUNTIME,
    init: (projectName, runtime, pm) => ({
      dependencies: runtime === "deno"
        ? {
          "@std/dotenv": "^0.225.2",
          "@hono/hono": "^4.5.0",
          "@hongminhee/x-forwarded-fetch": "^0.2.0",
        }
        : runtime === "node"
        ? {
          "@dotenvx/dotenvx": "^1.14.1",
          hono: "^4.5.0",
          "@hono/node-server": "^1.12.0",
          tsx: "^4.17.0",
          "x-forwarded-fetch": "^0.2.0",
        }
        : { hono: "^4.5.0", "x-forwarded-fetch": "^0.2.0" },
      devDependencies: runtime === "bun" ? { "@types/bun": "^1.1.6" } : {},
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      files: {
        "src/app.tsx": readTemplate("hono/app.tsx")
          .replace(
            /^import \{ Hono \} from "";$/,
            `import { Hono } from "${
              runtime === "deno" ? "@hono/hono" : "hono"
            }";`,
          )
          .replace(
            /getLogger\(\)/,
            `getLogger(${JSON.stringify(projectName)})`,
          ),
        "src/index.ts": readTemplate(`hono/index/${runtime}.ts`),
      },
      compilerOptions: runtime === "deno" ? undefined : {
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
        "dev": runtime === "deno"
          ? "deno run -A --watch ./src/index.ts"
          : runtime === "bun"
          ? "bun run --hot ./src/index.ts"
          : "dotenvx run -- tsx watch ./src/index.ts",
        "prod": runtime === "deno"
          ? "deno run -A ./src/index.ts"
          : runtime === "bun"
          ? "bun run ./src/index.ts"
          : "dotenvx run -- node --import tsx ./src/index.ts",
      },
      instruction: getInstruction(runtime, pm),
    }),
  },
  express: {
    label: "Express",
    runtimes: ["bun", "node"],
    init: (projectName, runtime, pm) => ({
      dependencies: {
        express: "^4.19.2",
        "@fedify/express": PACKAGE_VERSION,
        ...(runtime === "node"
          ? {
            "@dotenvx/dotenvx": "^1.14.1",
            tsx: "^4.17.0",
          }
          : {}),
      },
      devDependencies: {
        "@types/express": "^4.17.21",
        ...(runtime === "bun" ? { "@types/bun": "^1.1.6" } : {}),
      },
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      files: {
        "src/app.ts": readTemplate("express/app.ts")
          .replace(
            /getLogger\(\)/,
            `getLogger(${JSON.stringify(projectName)})`,
          ),
        "src/index.ts": readTemplate("express/index.ts"),
      },
      compilerOptions: runtime === "deno" ? undefined : {
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
        "dev": runtime === "bun"
          ? "bun run --hot ./src/index.ts"
          : "dotenvx run -- tsx watch ./src/index.ts",
        "prod": runtime === "bun"
          ? "bun run ./src/index.ts"
          : "dotenvx run -- node --import tsx ./src/index.ts",
      },
      instruction: getInstruction(runtime, pm),
    }),
  },
  nitro: {
    label: "Nitro",
    runtimes: ["bun", "node"],
    init: (_, runtime, pm) => ({
      command: [
        ...(runtime === "bun"
          ? ["bunx"]
          : pm === "npm" || pm === "yarn"
          ? ["npx", "--yes"]
          : [pm, "dlx"]),
        "giget@latest",
        "nitro",
        ".",
      ],
      dependencies: {
        "@fedify/h3": PACKAGE_VERSION,
      },
      federationFile: "server/federation.ts",
      loggingFile: "server/logging.ts",
      files: {
        "server/middleware/federation.ts": readTemplate(
          "nitro/server/middleware/federation.ts",
        ),
        "server/error.ts": readTemplate("nitro/server/error.ts"),
        "nitro.config.ts": readTemplate("nitro/nitro.config.ts"),
      },
      instruction: getInstruction(runtime, pm),
    }),
  },
  next: {
    label: "Next.js",
    runtimes: RUNTIME,
    init: (_, rt, pm) => ({
      label: "Next.js",
      command: getNextInitCommand(rt, pm),
      dependencies: { "@fedify/next": PACKAGE_VERSION },
      devDependencies: { "@types/node": "^20.11.2" },
      federationFile: "federation/index.ts",
      loggingFile: "logging.ts",
      files: { "middleware.ts": readTemplate("next/middleware.ts") },
      instruction: getInstruction(rt, pm),
    }),
  },
} as const;
export default webFrameworks;
