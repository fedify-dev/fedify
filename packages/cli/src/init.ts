import { Command, EnumType } from "@cliffy/command";
import { Select } from "@cliffy/prompt";
import { getLogger } from "@logtape/logtape";
import { stringify } from "@std/dotenv/stringify";
import * as colors from "@std/fmt/colors";
import { exists } from "@std/fs";
import { basename, dirname, join, normalize } from "@std/path";
import metadata from "../deno.json" with { type: "json" };

const packagesMetaData: Record<`@fedify/${string}`, string> = {
  "@fedify/fedify": metadata.version,
  "@fedify/redis": metadata.version,
  "@fedify/postgres": metadata.version,
  "@fedify/amqp": metadata.version,
  "@fedify/express": metadata.version,
  "@fedify/h3": metadata.version,
};

const logger = getLogger(["fedify", "cli", "init"]);

type Runtime = "deno" | "bun" | "node";

interface RuntimeDescription {
  label: string;
  checkCommand: [string, ...string[]];
  outputPattern: RegExp;
}

const runtimes: Record<Runtime, RuntimeDescription> = {
  deno: {
    label: "Deno",
    checkCommand: ["deno", "--version"],
    outputPattern: /^deno\s+\d+\.\d+\.\d+\b/,
  },
  bun: {
    label: "Bun",
    checkCommand: ["bun", "--version"],
    outputPattern: /^\d+\.\d+\.\d+$/,
  },
  node: {
    label: "Node.js",
    checkCommand: ["node", "--version"],
    outputPattern: /^v\d+\.\d+\.\d+$/,
  },
};

const runtimeAvailabilities: Record<Runtime, boolean> = Object.fromEntries(
  await Promise.all(
    (Object.keys(runtimes) as Runtime[])
      .map(async (r) => [r, await isRuntimeAvailable(r)]),
  ),
);

type PackageManager = "npm" | "yarn" | "pnpm";

interface PackageManagerDescription {
  label: string;
  checkCommand: [string, ...string[]];
  outputPattern: RegExp;
}

const packageManagers: Record<PackageManager, PackageManagerDescription> = {
  npm: {
    label: "npm",
    checkCommand: ["npm", "--version"],
    outputPattern: /^\d+\.\d+\.\d+$/,
  },
  yarn: {
    label: "Yarn",
    checkCommand: ["yarn", "--version"],
    outputPattern: /^\d+\.\d+\.\d+$/,
  },
  pnpm: {
    label: "pnpm",
    checkCommand: ["pnpm", "--version"],
    outputPattern: /^\d+\.\d+\.\d+$/,
  },
};

const packageManagerLocations: Record<PackageManager, string | undefined> =
  Object.fromEntries(
    await Promise.all(
      (Object.keys(packageManagers) as PackageManager[])
        .map(async (pm) => [pm, await locatePackageManager(pm)]),
    ),
  );

type WebFramework = "fresh" | "hono" | "express" | "nitro";

interface WebFrameworkInitializer {
  command?: [string, ...string[]] | [...string[], string];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  federationFile: string;
  loggingFile: string;
  files?: Record<string, string>;
  prependFiles?: Record<string, string>;
  compilerOptions?: Record<string, string | boolean | number | string[] | null>;
  tasks?: Record<string, string>;
  instruction: string;
}

interface WebFrameworkDescription {
  label: string;
  runtimes: Runtime[] | null;
  init(
    projectName: string,
    runtime: Runtime,
    pm: PackageManager,
  ): WebFrameworkInitializer;
}

const webFrameworks: Record<WebFramework, WebFrameworkDescription> = {
  fresh: {
    label: "Fresh",
    runtimes: ["deno"],
    init: (_, __, ___) => ({
      command: [
        "deno",
        "run",
        "-A",
        "https://deno.land/x/fresh@1.6.8/init.ts",
        ".",
      ],
      dependencies: { "@hongminhee/x-forwarded-fetch": "^0.2.0" },
      federationFile: "federation/mod.ts",
      loggingFile: "logging.ts",
      files: {
        "routes/_middleware.ts": `\
import { Handler } from "$fresh/server.ts";
import federation from "../federation/mod.ts";
import { integrateHandler } from "@fedify/fedify/x/fresh";

// This is the entry point to the Fedify middleware from the Fresh framework:
export const handler: Handler = integrateHandler(federation, () => undefined);
`,
        "dev.ts": `\
#!/usr/bin/env -S deno run -A --watch=static/,routes/

import dev from "$fresh/dev.ts";

import "$std/dotenv/load.ts";

await dev(import.meta.url, "./main.ts");
`,
        "main.ts": `\
/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />

import "$std/dotenv/load.ts";

import { ServerContext } from "$fresh/server.ts";
import manifest from "./fresh.gen.ts";
import config from "./fresh.config.ts";
import { behindProxy } from "@hongminhee/x-forwarded-fetch";

const ctx = await ServerContext.fromManifest(manifest, {
  ...config,
  dev: false,
});
const handler = behindProxy(ctx.handler());

Deno.serve({ handler, ...config.server });
`,
      },
      prependFiles: {
        "fresh.config.ts": 'import "./logging.ts";\n',
      },
      instruction: `
To start the server, run the following command:

  ${colors.bold(colors.green("deno task start"))}

Then, try look up an actor from your server:

  ${colors.bold(colors.green("fedify lookup http://localhost:8000/users/john"))}
`,
    }),
  },
  hono: {
    label: "Hono",
    runtimes: null,
    init: (projectName, runtime, pm) => ({
      dependencies: runtime === "deno"
        ? {
          "@std/dotenv": "^0.225.2",
          "@hono/hono": "^4.5.0",
          "@hongminhee/x-forwarded-fetch": "^0.2.0",
        } as Record<string, string>
        : runtime === "node"
        ? {
          "@dotenvx/dotenvx": "^1.14.1",
          hono: "^4.5.0",
          "@hono/node-server": "^1.12.0",
          tsx: "^4.17.0",
          "x-forwarded-fetch": "^0.2.0",
        }
        : { hono: "^4.5.0", "x-forwarded-fetch": "^0.2.0" },
      devDependencies: runtime === "bun"
        ? { "@types/bun": "^1.1.6" } as Record<string, string>
        : {},
      federationFile: "src/federation.ts",
      loggingFile: "src/logging.ts",
      files: {
        "src/app.tsx": `\
import { Hono } from "${runtime === "deno" ? "@hono/hono" : "hono"}";
import { federation } from "@fedify/fedify/x/hono";
import { getLogger } from "@logtape/logtape";
import fedi from "./federation.ts";

const logger = getLogger(${JSON.stringify(projectName)});

const app = new Hono();
app.use(federation(fedi, () => undefined))

app.get("/", (c) => c.text("Hello, Fedify!"));

export default app;
`,
        "src/index.ts": runtime === "node"
          ? `\
import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";
import app from "./app.tsx";
import "./logging.ts";

serve(
  {
    port: 8000,
    fetch: behindProxy(app.fetch.bind(app)),
  },
  (info) =>
    console.log("Server started at http://" + info.address + ":" + info.port)
);
`
          : runtime === "bun"
          ? `\
import { behindProxy } from "x-forwarded-fetch";
import app from "./app.tsx";
import "./logging.ts";

const server = Bun.serve({
  port: 8000,
  fetch: behindProxy(app.fetch.bind(app)),
});

console.log("Server started at", server.url.href);
`
          : `\
import "@std/dotenv/load";
import { behindProxy } from "@hongminhee/x-forwarded-fetch";
import app from "./app.tsx";
import "./logging.ts";

Deno.serve(
  {
    port: 8000,
    onListen: ({ port, hostname }) =>
      console.log("Server started at http://" + hostname + ":" + port)
  },
  behindProxy(app.fetch.bind(app)),
);
`,
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
      instruction: `
To start the server, run the following command:

  ${
        colors.bold(colors.green(
          runtime === "deno"
            ? "deno task dev"
            : runtime === "bun"
            ? "bun dev"
            : `${pm} run dev`,
        ))
      }

Then, try look up an actor from your server:

  ${colors.bold(colors.green("fedify lookup http://localhost:8000/users/john"))}
`,
    }),
  },
  express: {
    label: "Express",
    runtimes: ["bun", "node"],
    init: (projectName, runtime, pm) => ({
      dependencies: {
        express: "^4.19.2",
        "@fedify/express": getLatestVersion("@fedify/express"),
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
        "src/app.ts": `\
import express from "express";
import { integrateFederation } from "@fedify/express";
import { getLogger } from "@logtape/logtape";
import federation from "./federation.ts";

const logger = getLogger(${JSON.stringify(projectName)});

export const app = express();

app.set("trust proxy", true);

app.use(integrateFederation(federation, (req) => undefined));

app.get("/", (req, res) => res.send("Hello, Fedify!"));

export default app;
`,
        "src/index.ts": `\
import app from "./app.ts";
import "./logging.ts";

app.listen(8000, () => {
  console.log("Server started at http://localhost:8000");
});
`,
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
      instruction: `
To start the server, run the following command:

  ${colors.bold(colors.green(runtime === "bun" ? "bun dev" : `${pm} run dev`))}

Then, try look up an actor from your server:

  ${colors.bold(colors.green("fedify lookup http://localhost:8000/users/john"))}
`,
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
        "@fedify/h3": getLatestVersion("@fedify/h3"),
      },
      federationFile: "server/federation.ts",
      loggingFile: "server/logging.ts",
      files: {
        "server/middleware/federation.ts": `\
import { integrateFederation } from "@fedify/h3";
import federation from "../federation"

export default integrateFederation(
  federation,
  (event, request) => undefined,
);
`,
        "server/error.ts": `\
import { onError } from "@fedify/h3";

export default onError;
`,
        "nitro.config.ts": `\
//https://nitro.unjs.io/config
export default defineNitroConfig({
  srcDir: "server",
  errorHandler: "~/error"
});
`,
      },
      instruction: `
To start the server, run the following command:

  ${colors.bold(colors.green(runtime === "bun" ? "bun dev" : `${pm} run dev`))}

Then, try look up an actor from your server:

  ${colors.bold(colors.green("fedify lookup http://localhost:3000/users/john"))}
`,
    }),
  },
} as const;

type KvStore = "redis" | "postgres" | "denokv";

interface KvStoreDescription {
  label: string;
  runtimes?: Runtime[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  imports?: Record<string, string | string[]>;
  object: string | Record<Runtime, string>;
  denoUnstable?: string[];
  env?: Record<string, string>;
}

const kvStores: Record<KvStore, KvStoreDescription> = {
  redis: {
    label: "Redis",
    dependencies: {
      "@fedify/redis": getLatestVersion("@fedify/redis"),
      "npm:ioredis": "^5.4.1",
    },
    imports: { "@fedify/redis": ["RedisKvStore"], ioredis: ["Redis"] },
    object: {
      deno: 'new RedisKvStore(new Redis(Deno.env.get("REDIS_URL")))',
      node: "new RedisKvStore(new Redis(process.env.REDIS_URL))",
      bun: "new RedisKvStore(new Redis(process.env.REDIS_URL))",
    },
    env: {
      REDIS_URL: "redis://localhost:6379",
    },
  },
  postgres: {
    label: "PostgreSQL",
    dependencies: {
      "@fedify/postgres": getLatestVersion("@fedify/postgres"),
      "npm:postgres": "^3.4.5",
    },
    imports: { "@fedify/postgres": ["PostgresKvStore"], postgres: "postgres" },
    object: {
      deno: 'new PostgresKvStore(postgres(Deno.env.get("DATABASE_URL")))',
      node: "new PostgresKvStore(postgres(process.env.DATABASE_URL))",
      bun: "new PostgresKvStore(postgres(process.env.DATABASE_URL))",
    },
    env: {
      DATABASE_URL: "postgres://postgres@localhost:5432/postgres",
    },
  },
  denokv: {
    label: "Deno KV",
    runtimes: ["deno"],
    imports: { "@fedify/fedify/x/denokv": ["DenoKvStore"] },
    object: "new DenoKvStore(await Deno.openKv())",
    denoUnstable: ["kv"],
  },
} as const;

type MessageQueue = "redis" | "postgres" | "amqp" | "denokv";

interface MessageQueueDescription {
  label: string;
  runtimes?: Runtime[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  imports?: Record<string, string | string[]>;
  object: string | Record<Runtime, string>;
  denoUnstable?: string[];
  env?: Record<string, string>;
}

const messageQueues: Record<MessageQueue, MessageQueueDescription> = {
  redis: {
    label: "Redis",
    dependencies: {
      "@fedify/redis": getLatestVersion("@fedify/redis"),
      "npm:ioredis": "^5.4.1",
    },
    imports: { "@fedify/redis": ["RedisMessageQueue"], ioredis: ["Redis"] },
    object: {
      deno: 'new RedisMessageQueue(() => new Redis(Deno.env.get("REDIS_URL")))',
      node: "new RedisMessageQueue(() => new Redis(process.env.REDIS_URL))",
      bun: "new RedisMessageQueue(() => new Redis(process.env.REDIS_URL))",
    },
    env: {
      REDIS_URL: "redis://localhost:6379",
    },
  },
  postgres: {
    label: "PostgreSQL",
    dependencies: {
      "@fedify/postgres": getLatestVersion("@fedify/postgres"),
      "npm:postgres": "^3.4.5",
    },
    imports: {
      "@fedify/postgres": ["PostgresMessageQueue"],
      postgres: "postgres",
    },
    object: {
      deno: 'new PostgresMessageQueue(postgres(Deno.env.get("DATABASE_URL")))',
      node: "new PostgresMessageQueue(postgres(process.env.DATABASE_URL))",
      bun: "new PostgresMessageQueue(postgres(process.env.DATABASE_URL))",
    },
    env: {
      DATABASE_URL: "postgres://postgres@localhost:5432/postgres",
    },
  },
  amqp: {
    label: "AMQP (e.g., RabbitMQ)",
    dependencies: {
      "@fedify/amqp": getLatestVersion("@fedify/amqp"),
      "npm:amqplib": "^0.10.4",
    },
    devDependencies: {
      "npm:@types/amqplib": "^0.10.5",
    },
    imports: {
      "@fedify/amqp": ["AmqpMessageQueue"],
      amqplib: ["connect"],
    },
    object: {
      deno: 'new AmqpMessageQueue(await connect(Deno.env.get("AMQP_URL")))',
      node: "new AmqpMessageQueue(await connect(process.env.AMQP_URL))",
      bun: "new AmqpMessageQueue(await connect(process.env.AMQP_URL))",
    },
    env: {
      AMQP_URL: "amqp://localhost",
    },
  },
  denokv: {
    label: "Deno KV",
    runtimes: ["deno"],
    imports: { "@fedify/fedify/x/denokv": ["DenoKvMessageQueue"] },
    object: "new DenoKvMessageQueue(await Deno.openKv())",
    denoUnstable: ["kv"],
  },
} as const;

export const command = new Command()
  .type(
    "runtime",
    new EnumType(
      (Object.keys(runtimes) as Runtime[]).filter((r) =>
        runtimeAvailabilities[r]
      ),
    ),
  )
  .type(
    "package-manager",
    new EnumType(
      (Object.keys(packageManagers) as PackageManager[]).filter((pm) =>
        packageManagerLocations[pm]
      ),
    ),
  )
  .type(
    "web-framework",
    new EnumType(Object.keys(webFrameworks) as WebFramework[]),
  )
  .type("kv-store", new EnumType(Object.keys(kvStores) as KvStore[]))
  .type(
    "message-queue",
    new EnumType(Object.keys(messageQueues) as MessageQueue[]),
  )
  .arguments("<dir:file>")
  .description("Initialize a new Fedify project directory.")
  .option(
    "-r, --runtime <runtime:runtime>",
    "Choose the JavaScript runtime to use.",
  )
  .option(
    "-p, --package-manager <package-manager:package-manager>",
    "Choose the package manager to use.  Only applicable to -r/--runtime=node.",
  )
  .option(
    "-w, --web-framework <web-framework:web-framework>",
    "Choose the web framework to integrate Fedify with.",
  )
  .option(
    "-k, --kv-store <kv-store:kv-store>",
    "Choose the key–value store to use for caching.",
  )
  .option(
    "-q, --message-queue <message-queue:message-queue>",
    "Choose the message queue to use for background jobs.",
  )
  .option(
    "--dry-run",
    "Show what would be created without actually creating files.",
  )
  .action(async (options, dir: string) => {
    const dryRun = options.dryRun ?? false;
    const projectName = basename(
      await exists(dir) ? await Deno.realPath(dir) : normalize(dir),
    );
    let dinosaurDrawn = false;
    let runtime = options.runtime;
    if (runtime == null) {
      drawDinosaur();
      dinosaurDrawn = true;
      runtime = await Select.prompt({
        message: "Choose the JavaScript runtime to use",
        options: Object.entries(runtimes).map(([value, { label }]) => ({
          name: label,
          value,
          disabled: !runtimeAvailabilities[value as Runtime],
        })),
      }) as unknown as Runtime;
    }
    let packageManager = options.packageManager;
    if (runtime === "node" && packageManager == null) {
      if (!dinosaurDrawn) {
        drawDinosaur();
        dinosaurDrawn = true;
      }
      packageManager = await Select.prompt({
        message: "Choose the package manager to use",
        options: Object.entries(packageManagers).map(([value, { label }]) => ({
          name: label,
          value,
        })),
      }) as unknown as PackageManager;
    } else if (packageManager == null) packageManager = "npm";
    let webFramework = options.webFramework;
    if (webFramework == null && options.runtime == null) {
      if (!dinosaurDrawn) {
        drawDinosaur();
        dinosaurDrawn = true;
      }
      webFramework = await Select.prompt({
        message: "Choose the web framework to integrate Fedify with",
        options: [
          { name: "Bare-bones", value: null },
          ...Object.entries(webFrameworks).map((
            [value, { label, runtimes }],
          ) => ({
            name: label,
            value,
            disabled: runtimes != null && !runtimes.includes(runtime),
          })),
        ],
      }) as unknown as WebFramework;
    }
    if (
      webFramework != null && webFrameworks[webFramework].runtimes != null &&
      !webFrameworks[webFramework].runtimes!.includes(runtime)
    ) {
      console.error(
        `The ${
          webFrameworks[webFramework].label
        } framework is not available on the ${
          runtimes[runtime].label
        } runtime.`,
      );
      Deno.exit(1);
    }
    let kvStore = options.kvStore;
    if (kvStore == null && options.runtime == null) {
      if (!dinosaurDrawn) {
        drawDinosaur();
        dinosaurDrawn = true;
      }
      kvStore = await Select.prompt({
        message: "Choose the key–value store to use for caching",
        options: [
          { name: "In-memory", value: null },
          ...Object.entries(kvStores).map(([value, { label, runtimes }]) => ({
            name: label,
            value,
            disabled: runtimes != null && !runtimes.includes(runtime),
          })),
        ],
      }) as unknown as KvStore;
    }
    if (
      kvStore != null && kvStores[kvStore].runtimes != null &&
      !kvStores[kvStore].runtimes!.includes(runtime)
    ) {
      console.error(
        `The ${kvStores[kvStore].label} store is not available on the ${
          runtimes[runtime].label
        } runtime.`,
      );
      Deno.exit(1);
    }
    let messageQueue = options.messageQueue;
    if (messageQueue == null && options.runtime == null) {
      if (!dinosaurDrawn) {
        drawDinosaur();
        dinosaurDrawn = true;
      }
      messageQueue = await Select.prompt({
        message: "Choose the message queue to use for background jobs",
        options: [
          { name: "In-process", value: null },
          ...Object.entries(messageQueues).map((
            [value, { label, runtimes }],
          ) => ({
            name: label,
            value,
            disabled: runtimes != null && !runtimes.includes(runtime),
          })),
        ],
      }) as unknown as MessageQueue;
    }
    if (
      messageQueue != null && messageQueues[messageQueue].runtimes != null &&
      !messageQueues[messageQueue].runtimes!.includes(runtime)
    ) {
      console.error(
        `The ${
          messageQueues[messageQueue].label
        } message queue is not available on the ${
          runtimes[runtime].label
        } runtime.`,
      );
      Deno.exit(1);
    }
    logger.debug(
      "Runtime: {runtime}; package manager: {packageManager}; " +
        "web framework: {webFramework}; key–value store: {kvStore}; " +
        "message queue: {messageQueue}",
      {
        runtime,
        packageManager,
        webFramework,
        kvStore,
        messageQueue,
      },
    );
    if (!runtimeAvailabilities[runtime]) {
      console.error(
        `The ${
          runtimes[runtime].label
        } runtime is not available on this system.`,
      );
      Deno.exit(1);
    }
    if (runtime === "node" && !packageManagerLocations[packageManager]) {
      console.error(`The ${packageManager} is not available on this system.`);
      Deno.exit(1);
    }
    let initializer: WebFrameworkInitializer;
    if (webFramework == null) {
      initializer = {
        federationFile: "federation.ts",
        loggingFile: "logging.ts",
        dependencies: runtime === "deno"
          ? {
            "@std/dotenv": "^0.225.2",
            "@hongminhee/x-forwarded-fetch": "^0.2.0",
          }
          : runtime === "node"
          ? {
            "@dotenvx/dotenvx": "^1.14.1",
            "@hono/node-server": "^1.12.0",
            tsx: "^4.17.0",
            "x-forwarded-fetch": "^0.2.0",
          }
          : { "x-forwarded-fetch": "^0.2.0" },
        devDependencies: runtime === "bun" ? { "@types/bun": "^1.1.6" } : {},
        files: {
          "main.ts": runtime === "node"
            ? `\
import { serve } from "@hono/node-server";
import { behindProxy } from "x-forwarded-fetch";
import federation from "./federation.ts";
import "./logging.ts";

serve(
  {
    port: 8000,
    fetch: behindProxy(
      (req) => federation.fetch(req, { contextData: undefined }),
    ),
  },
  (info) =>
    console.log("Server started at http://" + info.address + ":" + info.port)
);
`
            : runtime === "bun"
            ? `\
import { behindProxy } from "x-forwarded-fetch";
import federation from "./federation.ts";
import "./logging.ts";

const server = Bun.serve({
  port: 8000,
  fetch: behindProxy(
    (req) => federation.fetch(req, { contextData: undefined }),
  ),
});

console.log("Server started at", server.url.href);
`
            : `\
import "@std/dotenv/load";
import { behindProxy } from "@hongminhee/x-forwarded-fetch";
import federation from "./federation.ts";
import "./logging.ts";

Deno.serve(
  {
    port: 8000,
    onListen: ({ port, hostname }) =>
      console.log("Server started at http://" + hostname + ":" + port)
  },
  behindProxy((req) => federation.fetch(req, { contextData: undefined })),
);
`,
        },
        compilerOptions: runtime === "deno"
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
          },
        tasks: {
          "dev": runtime === "deno"
            ? "deno run -A --watch ./main.ts"
            : runtime === "bun"
            ? "bun run --hot ./main.ts"
            : "dotenvx run -- tsx watch ./main.ts",
          "prod": runtime === "deno"
            ? "deno run -A ./main.ts"
            : runtime === "bun"
            ? "bun run ./main.ts"
            : "dotenvx run -- node --import tsx ./main.ts",
        },
        instruction: `
To start the server, run the following command:

  ${
          colors.bold(colors.green(
            runtime === "deno"
              ? "deno task dev"
              : runtime === "bun"
              ? "bun dev"
              : `${packageManager} run dev`,
          ))
        }

Then, try look up an actor from your server:

  ${colors.bold(colors.green("fedify lookup http://localhost:8000/users/john"))}
`,
      };
    } else {
      const desc = webFrameworks[webFramework];
      if (desc.runtimes != null && !desc.runtimes.includes(runtime)) {
        console.error(
          `The ${desc.label} framework is not available on the ${
            runtimes[runtime].label
          } runtime.`,
        );
        Deno.exit(1);
      }
      initializer = desc.init(projectName, runtime, packageManager);
    }
    const kvStoreDesc: KvStoreDescription = kvStore != null
      ? kvStores[kvStore]
      : {
        label: "",
        imports: { "@fedify/fedify": ["MemoryKvStore"] },
        object: "new MemoryKvStore()",
      };
    const mqDesc: MessageQueueDescription = messageQueue != null
      ? messageQueues[messageQueue]
      : {
        label: "",
        imports: { "@fedify/fedify": ["InProcessMessageQueue"] },
        object: "new InProcessMessageQueue()",
      };
    const imports: Record<string, { $: string | null; names: string[] }> = {};
    for (
      const [module, symbols] of [
        ...Object.entries(kvStoreDesc.imports ?? {}),
        ...Object.entries(mqDesc.imports ?? {}),
      ]
    ) {
      if (module in imports) {
        if (Array.isArray(symbols)) {
          for (const symbol of symbols) {
            if (imports[module].names.includes(symbol)) continue;
            imports[module].names.push(symbol);
          }
        } else if (imports[module].$ == null) {
          imports[module].$ = symbols;
        } else if (symbols !== imports[module].$) {
          throw new Error(
            "Multiple default imports from the same module; report this as a bug.",
          );
        }
      } else {
        if (Array.isArray(symbols)) {
          imports[module] = { $: null, names: symbols };
        } else {
          imports[module] = { $: symbols, names: [] };
        }
      }
    }
    const importStatements = Object.entries(imports)
      .map((
        [module, { $, names }],
      ) =>
        [
          $ == null ? null : `import ${$} from ${JSON.stringify(module)};`,
          names.length > 0
            ? `import { ${names.join(", ")} } from ${JSON.stringify(module)};`
            : null,
        ].filter((s) => s != null).join("\n")
      )
      .join("\n");
    const federation = `\
import { createFederation, Person } from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
${importStatements}

const logger = getLogger(${JSON.stringify(projectName)});

const federation = createFederation({
  kv: ${
      typeof kvStoreDesc.object === "string"
        ? kvStoreDesc.object
        : kvStoreDesc.object[runtime]
    },
  queue: ${
      typeof mqDesc.object === "string" ? mqDesc.object : mqDesc.object[runtime]
    },
});

federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  return new Person({
    id: ctx.getActorUri(identifier),
    preferredUsername: identifier,
    name: identifier,
  });
});

export default federation;
`;
    const logging = `\
import { configure, getConsoleSink } from "@logtape/logtape";
import { AsyncLocalStorage } from "node:async_hooks";

await configure({
  contextLocalStorage: new AsyncLocalStorage(),
  sinks: {
    console: getConsoleSink(),
  },
  filters: {},
  loggers: [
    { category: ${
      JSON.stringify(projectName)
    }, lowestLevel: "debug", sinks: ["console"] },
    { category: "fedify", lowestLevel: "info", sinks: ["console"] },
    { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
  ],
});
`;
    const env = { ...kvStoreDesc.env, ...mqDesc.env };
    const files = {
      [initializer.federationFile]: federation,
      [initializer.loggingFile]: logging,
      ".env": stringify(env),
      ...initializer.files,
    };
    const { prependFiles } = initializer;

    if (dryRun) {
      console.log(
        colors.bold(
          colors.yellow("🔍 DRY RUN MODE - No files will be created\n"),
        ),
      );
    }

    // Check if directory is empty
    const checkDirectoryEmpty = async (path: string) => {
      try {
        for await (const _ of Deno.readDir(path)) {
          console.error("The directory is not empty.  Aborting.");
          Deno.exit(1);
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) {
          throw e;
        }
      }
    };

    if (dryRun) {
      await checkDirectoryEmpty(dir);
    } else {
      await Deno.mkdir(dir, { recursive: true });
      await checkDirectoryEmpty(dir);
    }
    if (initializer.command != null) {
      if (dryRun) {
        console.log(colors.bold(colors.cyan("📦 Would run command:")));
        console.log(
          `  ${
            [initializer.command[0], ...initializer.command.slice(1)].join(" ")
          }\n`,
        );
      } else {
        const cmd = new Deno.Command(initializer.command[0], {
          args: initializer.command.slice(1),
          cwd: dir,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        const result = await cmd.output();
        if (!result.success) {
          console.error("Failed to initialize the project.");
          Deno.exit(1);
        }
      }
    }
    if (runtime !== "deno") {
      const packageJsonPath = join(dir, "package.json");
      if (!dryRun) {
        try {
          await Deno.stat(packageJsonPath);
        } catch (e) {
          if (e instanceof Deno.errors.NotFound) {
            await Deno.writeTextFile(packageJsonPath, "{}");
          } else throw e;
        }
      }
    }
    const dependencies: Record<string, string> = {
      "@fedify/fedify": getLatestVersion("@fedify/fedify"),
      "@logtape/logtape": "^0.8.2",
      ...initializer.dependencies,
      ...kvStoreDesc?.dependencies,
      ...mqDesc?.dependencies,
    };
    if (dryRun) {
      const deps = Object.entries(dependencies)
        .map(([name, version]) => `${name}@${version}`)
        .join("\n");
      if (deps) {
        console.log(colors.bold(colors.cyan("📦 Would install dependencies:")));
        console.log(`${deps}\n`);
      }
    } else {
      await addDependencies(
        runtime,
        packageManager,
        dir,
        dependencies,
      );
    }
    if (runtime !== "deno") {
      const devDependencies: Record<string, string> = {
        "@biomejs/biome": "^1.8.3",
        ...initializer.devDependencies,
        ...kvStoreDesc?.devDependencies,
        ...mqDesc?.devDependencies,
      };
      if (dryRun) {
        const devDeps = Object.entries(devDependencies)
          .map(([name, version]) => `${name}@${version}`)
          .join("\n");
        if (devDeps) {
          console.log(
            colors.bold(colors.cyan("📦 Would install dev dependencies:")),
          );
          console.log(`${devDeps}\n`);
        }
      } else {
        await addDependencies(
          runtime,
          packageManager,
          dir,
          devDependencies,
          true,
        );
      }
    }
    if (dryRun) {
      console.log(colors.bold(colors.green("📄 Would create files:\n")));
      for (const [filename, content] of Object.entries(files)) {
        const path = join(dir, filename);
        displayFileContent(path, content);
      }
    } else {
      for (const [filename, content] of Object.entries(files)) {
        const path = join(dir, filename);
        const dirName = dirname(path);
        await Deno.mkdir(dirName, { recursive: true });
        await Deno.writeTextFile(path, content);
      }
    }
    if (prependFiles != null) {
      if (dryRun) {
        console.log(colors.bold(colors.blue("Would prepend to files:\n")));
        for (const [filename, prefix] of Object.entries(prependFiles)) {
          const path = join(dir, filename);
          console.log(colors.blue(`${path}`));
          console.log(colors.gray("─".repeat(60)));
          console.log(colors.gray("Prepending:"));
          console.log(prefix);
          console.log(colors.gray("─".repeat(60)) + "\n");
        }
      } else {
        for (const [filename, prefix] of Object.entries(prependFiles)) {
          const path = join(dir, filename);
          const dirName = dirname(path);
          await Deno.mkdir(dirName, { recursive: true });
          await Deno.writeTextFile(
            path,
            `${prefix}${await Deno.readTextFile(path)}`,
          );
        }
      }
    }
    if (runtime === "deno") {
      if (dryRun) {
        console.log(
          colors.bold(colors.green("Would create/update JSON files:\n")),
        );
      }
      await rewriteJsonFile(
        join(dir, "deno.json"),
        {},
        (cfg) => ({
          ...cfg,
          ...initializer.compilerOptions == null ? {} : {
            compilerOptions: {
              ...cfg?.compilerOptions,
              ...initializer.compilerOptions,
            },
          },
          unstable: [
            "temporal",
            ...kvStoreDesc.denoUnstable ?? [],
            ...mqDesc.denoUnstable ?? [],
          ],
          tasks: { ...cfg.tasks, ...initializer.tasks },
        }),
        dryRun,
      );
      await rewriteJsonFile(
        join(dir, ".vscode", "settings.json"),
        {},
        (vsCodeSettings) => ({
          "deno.enable": true,
          "deno.unstable": true,
          "editor.detectIndentation": false,
          "editor.indentSize": 2,
          "editor.insertSpaces": true,
          "[javascript]": {
            "editor.defaultFormatter": "denoland.vscode-deno",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.sortImports": "always",
            },
          },
          "[javascriptreact]": {
            "editor.defaultFormatter": "denoland.vscode-deno",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.sortImports": "always",
            },
          },
          "[json]": {
            "editor.defaultFormatter": "vscode.json-language-features",
            "editor.formatOnSave": true,
          },
          "[jsonc]": {
            "editor.defaultFormatter": "vscode.json-language-features",
            "editor.formatOnSave": true,
          },
          "[typescript]": {
            "editor.defaultFormatter": "denoland.vscode-deno",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.sortImports": "always",
            },
          },
          "[typescriptreact]": {
            "editor.defaultFormatter": "denoland.vscode-deno",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.sortImports": "always",
            },
          },
          ...vsCodeSettings,
        }),
        dryRun,
      );
      await rewriteJsonFile(
        join(dir, ".vscode", "extensions.json"),
        {},
        (vsCodeExtensions) => ({
          recommendations: uniqueArray([
            "denoland.vscode-deno",
            ...vsCodeExtensions.recommendations ?? [],
          ]),
          ...vsCodeExtensions,
        }),
        dryRun,
      );
    } else {
      if (dryRun) {
        console.log(
          colors.bold(colors.green("Would create/update JSON files:\n")),
        );
      }
      await rewriteJsonFile(
        join(dir, "package.json"),
        {},
        (cfg) => ({
          type: "module",
          ...cfg,
          scripts: { ...cfg.scripts, ...initializer.tasks },
        }),
        dryRun,
      );
      if (initializer.compilerOptions != null) {
        await rewriteJsonFile(
          join(dir, "tsconfig.json"),
          {},
          (cfg) => ({
            ...cfg,
            compilerOptions: {
              ...cfg?.compilerOptions,
              ...initializer.compilerOptions,
            },
          }),
          dryRun,
        );
      }
      await rewriteJsonFile(
        join(dir, ".vscode", "settings.json"),
        {},
        (vsCodeSettings) => ({
          "editor.detectIndentation": false,
          "editor.indentSize": 2,
          "editor.insertSpaces": true,
          "[javascript]": {
            "editor.defaultFormatter": "biomejs.biome",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.organizeImports.biome": "always",
            },
          },
          "[javascriptreact]": {
            "editor.defaultFormatter": "biomejs.biome",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.organizeImports.biome": "always",
            },
          },
          "[json]": {
            "editor.defaultFormatter": "biomejs.biome",
            "editor.formatOnSave": true,
          },
          "[jsonc]": {
            "editor.defaultFormatter": "biomejs.biome",
            "editor.formatOnSave": true,
          },
          "[typescript]": {
            "editor.defaultFormatter": "biomejs.biome",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.organizeImports.biome": "always",
            },
          },
          "[typescriptreact]": {
            "editor.defaultFormatter": "biomejs.biome",
            "editor.formatOnSave": true,
            "editor.codeActionsOnSave": {
              "source.organizeImports.biome": "always",
            },
          },
          ...vsCodeSettings,
        }),
        dryRun,
      );
      await rewriteJsonFile(
        join(dir, ".vscode", "extensions.json"),
        {},
        (vsCodeExtensions) => ({
          recommendations: uniqueArray([
            "biomejs.biome",
            ...vsCodeExtensions.recommendations ?? [],
          ]),
          ...vsCodeExtensions,
        }),
        dryRun,
      );
      await rewriteJsonFile(
        join(dir, "biome.json"),
        {},
        (cfg) => ({
          "$schema": "https://biomejs.dev/schemas/1.8.3/schema.json",
          ...cfg,
          organizeImports: {
            ...cfg.organizeImports,
            enabled: true,
          },
          formatter: {
            ...cfg.formatter,
            enabled: true,
            indentStyle: "space",
            indentWidth: 2,
          },
          linter: {
            ...cfg.linter,
            enabled: true,
            rules: { recommended: true },
          },
        }),
        dryRun,
      );
    }
    console.error(initializer.instruction);
    if (Object.keys(env).length > 0) {
      console.error(
        `Note that you probably want to edit the ${
          colors.bold(colors.blue(".env"))
        } file.  It currently contains the following values:\n`,
      );
      for (const key in env) {
        const value = stringify({ _: env[key] }).substring(2);
        console.error(
          `  ${colors.bold(colors.green(key))}${colors.gray("=")}${value}`,
        );
      }
      console.error();
    }
    console.error(`\
Start by editing the ${colors.bold(colors.blue(initializer.federationFile))} \
file to define your federation!
`);
  });

function drawDinosaur() {
  const d = (text: string) => colors.bgBlue(colors.black(text));
  const f = colors.blue;
  console.error(`\
${d("             ___   ")}  ${f(" _____        _ _  __")}
${d("            /'_')  ")}  ${f("|  ___|__  __| (_)/ _|_   _")}
${d("     .-^^^-/  /    ")}  ${f("| |_ / _ \\/ _` | | |_| | | |")}
${d("   __/       /     ")}  ${f("|  _|  __/ (_| | |  _| |_| |")}
${d("  <__.|_|-|_|      ")}  ${f("|_|  \\___|\\__,_|_|_|  \\__, |")}
${d("                   ")}  ${f("                      |___/")}
`);
}

function displayFileContent(
  path: string,
  content: string,
  emoji: string = "📄",
  pathColor: (text: string) => string = colors.green,
) {
  console.log(pathColor(`${emoji} ${path}`));
  console.error(colors.gray("─".repeat(60)));
  console.log(content);
  console.error(colors.gray("─".repeat(60)) + "\n");
}

async function isCommandAvailable(
  { checkCommand, outputPattern }: {
    checkCommand: [string, ...string[]];
    outputPattern: RegExp;
  },
): Promise<boolean> {
  const cmd = new Deno.Command(checkCommand[0], {
    args: checkCommand.slice(1),
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  });
  try {
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    logger.debug(
      "The stdout of the command {command} is: {stdout}",
      { command: checkCommand, stdout },
    );
    return outputPattern.exec(stdout.trim()) ? true : false;
  } catch (error) {
    logger.debug(
      "The command {command} failed with the error: {error}",
      { command: checkCommand, error },
    );
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function isRuntimeAvailable(runtime: Runtime): Promise<boolean> {
  return isCommandAvailable(runtimes[runtime]);
}

async function locatePackageManager(
  pm: PackageManager,
): Promise<string | undefined> {
  if (await isCommandAvailable(packageManagers[pm])) {
    return packageManagers[pm].checkCommand[0];
  }
  if (Deno.build.os !== "windows") return undefined;
  const cmd: [string, ...string[]] = [
    packageManagers[pm].checkCommand[0] + ".cmd",
    ...packageManagers[pm].checkCommand.slice(1),
  ];
  if (await isCommandAvailable({ ...packageManagers[pm], checkCommand: cmd })) {
    return cmd[0];
  }
  return undefined;
}

async function addDependencies(
  runtime: Runtime,
  pm: PackageManager,
  dir: string,
  dependencies: Record<string, string>,
  dev: boolean = false,
): Promise<void> {
  const deps = Object.entries(dependencies)
    .map(([name, version]) =>
      `${
        runtime !== "deno" && name.startsWith("npm:")
          ? name.substring(4)
          : runtime === "deno" && !name.startsWith("npm:")
          ? `jsr:${name}`
          : name
      }@${
        runtime !== "deno" && version.includes("+")
          ? version.substring(0, version.indexOf("+"))
          : version
      }`
    );
  if (deps.length < 1) return;
  const cmd = new Deno.Command(
    runtime === "node" ? (packageManagerLocations[pm] ?? pm) : runtime,
    {
      args: [
        "add",
        ...(dev
          ? [runtime === "bun" || pm === "yarn" ? "--dev" : "--save-dev"]
          : []),
        ...uniqueArray(deps),
      ],
      cwd: dir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const result = await cmd.output();
  if (!result.success) {
    throw new Error("Failed to add dependencies.");
  }
}

function getLatestVersion(packageName: `@fedify/${string}`): string {
  const version = packagesMetaData[packageName];
  if (!version) {
    throw new Error(
      `Version for package "${packageName}" not found in local metadata.`,
    );
  }
  return version;
}
async function rewriteJsonFile(
  path: string,
  // deno-lint-ignore no-explicit-any
  empty: any,
  // deno-lint-ignore no-explicit-any
  rewriter: (json: any) => any,
  dryRun: boolean = false,
): Promise<void> {
  let jsonText: string | null = null;
  try {
    jsonText = await Deno.readTextFile(path);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  let json = jsonText == null ? empty : JSON.parse(jsonText);
  json = rewriter(json);

  if (dryRun) {
    displayFileContent(path, JSON.stringify(json, null, 2));
  } else {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(json, null, 2) + "\n");
  }
}

function uniqueArray<T extends boolean | number | string>(a: T[]): T[] {
  const result: T[] = [];
  for (const v of a) {
    if (!result.includes(v)) result.push(v);
  }
  return result;
}

// cSpell: ignore asynciterable bunx giget denoland biomejs dotenvx
