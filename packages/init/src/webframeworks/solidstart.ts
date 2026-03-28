import { PACKAGE_MANAGER } from "../const.ts";
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import { getInstruction } from "./utils.ts";

const solidstartDescription: WebFrameworkDescription = {
  label: "SolidStart",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 3000,
  init: async ({ packageManager: pm }) => ({
    dependencies: pm === "deno"
      ? {
        ...defaultDenoDependencies,
        "@solidjs/router": "npm:@solidjs/router@^0.15.4",
        "@solidjs/start": "npm:@solidjs/start@^1.3.2",
        "@solidjs/start/client": "npm:@solidjs/start@^1.3.2/client",
        "@solidjs/start/config": "npm:@solidjs/start@^1.3.2/config",
        "@solidjs/start/middleware": "npm:@solidjs/start@^1.3.2/middleware",
        "@solidjs/start/router": "npm:@solidjs/start@^1.3.2/router",
        "@solidjs/start/server": "npm:@solidjs/start@^1.3.2/server",
        "solid-js": "npm:solid-js@^1.9.11",
        vinxi: "npm:vinxi@^0.5.11",
        "@fedify/solidstart": PACKAGE_VERSION,
      }
      : {
        "@solidjs/router": "^0.15.4",
        "@solidjs/start": "^1.3.2",
        "solid-js": "^1.9.11",
        vinxi: "^0.5.11",
        "@fedify/solidstart": PACKAGE_VERSION,
      },
    devDependencies: {
      ...defaultDevDependencies,
      ...(pm !== "deno"
        ? { typescript: "^5.9.3", "@types/node": "^22.17.0" }
        : {}),
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
    tasks: {
      dev: pm === "deno"
        ? "deno run -A npm:vinxi dev"
        : pm === "bun"
        ? "bunx vinxi dev"
        : "vinxi dev",
      build: pm === "deno"
        ? "deno run -A npm:vinxi build"
        : pm === "bun"
        ? "bunx vinxi build"
        : "vinxi build",
      start: pm === "deno"
        ? "deno run -A npm:vinxi start"
        : pm === "bun"
        ? "bunx vinxi start"
        : "vinxi start",
      ...(pm !== "deno" ? { lint: "eslint ." } : {}),
    },
    instruction: getInstruction(pm, 3000),
  }),
};

export default solidstartDescription;
