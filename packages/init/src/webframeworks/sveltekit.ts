import { PACKAGE_MANAGER } from "../const.ts";
import deps from "../json/deps.json" with { type: "json" };
import { PACKAGE_VERSION, readTemplate } from "../lib.ts";
import type { PackageManager, WebFrameworkDescription } from "../types.ts";
import { defaultDenoDependencies, defaultDevDependencies } from "./const.ts";
import {
  getInstruction,
  getTestDependencies,
  getTestTask,
  nodeBunDevToolTasks,
  pmToRt,
} from "./utils.ts";

const sveltekitDescription: WebFrameworkDescription = {
  label: "SvelteKit",
  packageManagers: PACKAGE_MANAGER,
  defaultPort: 5173,
  init: async ({ packageManager: pm, testMode }) => ({
    command: Array.from(getInitCommand(pm)),
    dependencies: {
      "@fedify/sveltekit": PACKAGE_VERSION,
      ...(pm === "deno" ? defaultDenoDependencies : {}),
    },
    devDependencies: {
      ...defaultDevDependencies,
      "typescript": deps["npm:typescript@6"],
      "@types/node": deps["npm:@types/node@25"],
      ...(pmToRt(pm) === "deno"
        ? {}
        : { "@dotenvx/dotenvx": deps["npm:@dotenvx/dotenvx"] }),
      ...getTestDependencies(pm),
    },
    federationFile: "src/lib/federation.ts",
    loggingFile: "src/lib/logging.ts",
    testFile: "scripts/smoke.test.ts",
    env: testMode ? { HOST: "127.0.0.1" } : {} as Record<string, string>,
    files: {
      "src/hooks.server.ts": await readTemplate("sveltekit/hooks.server.ts"),
    },
    tasks: pmToRt(pm) === "deno"
      ? { test: getTestTask("deno") }
      : { ...TASKS, test: getTestTask(pm) },
    instruction: getInstruction(pm, 5173),
  }),
};

export default sveltekitDescription;

/**
 * Returns the shell command array to scaffold a new SvelteKit project
 * in the current directory using the given package manager.
 */
function* getInitCommand(pm: PackageManager) {
  yield* getSvelteKitInitCommand(pm);
  yield* [
    ".",
    "--template",
    "minimal",
    "--types",
    "ts",
    "--no-add-ons",
    "--no-dir-check",
    "--no-download-check",
    "--install",
    pm,
  ];
}

const getSvelteKitInitCommand = (pm: PackageManager): string[] =>
  pm === "bun"
    ? ["bunx", "sv", "create"]
    : pm === "deno"
    ? ["deno", "run", "-A", "npm:sv", "create"]
    : pm === "npm"
    ? ["npx", "sv", "create"]
    : [pm, "dlx", "sv", "create"];

const TASKS = {
  "dev": "dotenvx run -- vite dev",
  "build": "dotenvx run -- vite build",
  "preview": "dotenvx run -- vite preview",
  ...nodeBunDevToolTasks,
};
