import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction, pmToRt } from "./utils.ts";

const NPM_SOLIDSTART = `npm:@solidjs/start@${deps["npm:@solidjs/start"]}`;
const solidstartDescription: WebFrameworkDescription = {
  label: "SolidStart",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: async ({ packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@solidjs/router": `npm:@solidjs/router@${deps["npm:@solidjs/router"]}`,
        "@solidjs/start": `${NPM_SOLIDSTART}`,
        "@solidjs/start/client": `${NPM_SOLIDSTART}/client`,
        "@solidjs/start/config": `${NPM_SOLIDSTART}/config`,
        "@solidjs/start/middleware": `${NPM_SOLIDSTART}/middleware`,
        "@solidjs/start/router": `${NPM_SOLIDSTART}/router`,
        "@solidjs/start/server": `${NPM_SOLIDSTART}/server`,
        "solid-js": `npm:solid-js@${deps["npm:solid-js"]}`,
        vinxi: `npm:vinxi@${deps["npm:vinxi"]}`,
        "@fedify/solidstart": PACKAGE_VERSION,
      }
      : {
        "@solidjs/router": deps["npm:@solidjs/router"],
        "@solidjs/start": deps["npm:@solidjs/start"],
        "solid-js": deps["npm:solid-js"],
        vinxi: deps["npm:vinxi"],
        "@fedify/solidstart": PACKAGE_VERSION,
      },
    devDependencies: {
      ...defaultDevDependencies,
      typescript: deps["npm:typescript"],
      "@types/node": deps["npm:@types/node@22"],
    },
    federationFile: "src/federation.ts",
    loggingFile: "src/logging.ts",
    files: {
      "app.config.ts": (await readTemplate("solidstart/app.config.ts"))
        .replace(
          /\/\* preset \*\//,
          pm === "deno" ? "deno-server" : "node-server",
        ),
      "src/app.tsx": await readTemplate("solidstart/src/app.tsx"),
      "src/entry-client.tsx": await readTemplate(
        "solidstart/src/entry-client.tsx",
      ),
      "src/entry-server.tsx": await readTemplate(
        "solidstart/src/entry-server.tsx",
      ),
      "src/routes/index.tsx": await readTemplate(
        "solidstart/src/routes/index.tsx",
      ),
      "src/middleware/index.ts": await readTemplate(
        "solidstart/src/middleware/index.ts",
      ),
      ...(pm !== "deno"
        ? {
          "eslint.config.ts": await readTemplate("defaults/eslint.config.ts"),
        }
        : {}),
    },
    compilerOptions: pm === "deno" ? undefined : {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "Bundler",
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      jsx: "preserve",
      jsxImportSource: "solid-js",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    tasks: TASKS[pmToRt(pm)],
    instruction: getInstruction(pm, 3000),
  }),
};

export default solidstartDescription;

const TASKS = {
  deno: {
    dev: "deno run -A npm:vinxi dev",
    build: "deno run -A npm:vinxi build",
    start: "deno run -A npm:vinxi start",
  },
  bun: {
    dev: "bunx vinxi dev",
    build: "bunx vinxi build",
    start: "bunx vinxi start",
    lint: "eslint .",
  },
  node: {
    dev: "vinxi dev",
    build: "vinxi build",
    start: "vinxi start",
    lint: "eslint .",
  },
};
