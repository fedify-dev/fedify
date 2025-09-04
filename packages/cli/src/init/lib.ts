import metadata from "../../deno.json" with { type: "json" };
import * as colors from "@std/fmt/colors";
import type {
  KvStores,
  MessageQueues,
  PackageManager,
  PackageManagerDescription,
  RuntimeDescription,
} from "./types.ts";
import kv from "./templates/json/kv.json" with { type: "json" };
import mq from "./templates/json/mq.json" with { type: "json" };
import vscodeSettings from "./templates/json/vscode-settings.json" with {
  type: "json",
};
import { curry, flow, toMerged, uniq } from "jsr:@es-toolkit/es-toolkit";
import { dirname, join } from "@std/path";
import type { InitCommand } from "./command.ts";
import webFrameworks from "./webframeworks.ts";
import { getLogger } from "@logtape/logtape";
import { PACKAGE_MANAGER } from "./const.ts";

export const PACKAGE_VERSION = metadata.version;
export const logger = getLogger(["fedify", "cli", "init"]);

const addFedifyDeps = <T extends object>(json: T): T =>
  Object.fromEntries(
    Object.entries(json).map(([key, value]) => [
      key,
      toMerged(value, {
        dependencies: {
          [`@fedify/${key}`]: PACKAGE_VERSION,
        },
      }) as typeof value,
    ]),
  ) as T;
export const kvStores = addFedifyDeps(kv as KvStores);
export const messageQueues = addFedifyDeps(mq as MessageQueues);

export function drawDinosaur() {
  const d = flow(colors.bgBlue, colors.black);
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
export const logOptions: (options: Required<InitCommand>) => void = (options) =>
  logger.debug(
    "Package manager: {packageManager}; " +
      "web framework: {webFramework}; key–value store: {kvStore}; " +
      "message queue: {messageQueue}",
    options,
  );

export function validateOptions(
  options: Required<InitCommand>,
): Required<InitCommand> {
  try {
    const {
      webFramework,
      kvStore,
      messageQueue,
      packageManager,
    } = options;

    [
      validatePackageMangerWith(webFrameworks[webFramework], "framework"),
      validatePackageMangerWith(kvStores[kvStore], "kv store"),
      validatePackageMangerWith(messageQueues[messageQueue], "message queue"),
    ].map((f) => f(packageManager));
    if (!packageManagerLocations[packageManager]) {
      throw new Error(`The ${packageManager} is not available on this system.`);
    }
    return options;
  } catch (e) {
    if (e instanceof Error) console.error(e.message);
    Deno.exit(1);
  }
}
const packageManagerLocations: Record<
  PackageManager,
  string | undefined
> = Object.fromEntries(
  await Promise.all(
    PACKAGE_MANAGER
      .map(async (pm) => [pm, await locatePackageManager(pm)]),
  ),
);
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
const packageManagers: Record<
  PackageManager,
  PackageManagerDescription
> = {
  deno: {
    label: "deno",
    checkCommand: ["deno", "--version"],
    outputPattern: /^\d+\.\d+\.\d+$/,
  },
  bun: {
    label: "bun",
    checkCommand: ["bun", "--version"],
    outputPattern: /^\d+\.\d+\.\d+$/,
  },
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
const runtimes: Record<PackageManager, RuntimeDescription> = {
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
  pnpm: {
    label: "Node.js",
    checkCommand: ["node", "--version"],
    outputPattern: /^v\d+\.\d+\.\d+$/,
  },
  yarn: {
    label: "Node.js",
    checkCommand: ["node", "--version"],
    outputPattern: /^v\d+\.\d+\.\d+$/,
  },
  npm: {
    label: "Node.js",
    checkCommand: ["node", "--version"],
    outputPattern: /^v\d+\.\d+\.\d+$/,
  },
};

export const validatePackageMangerWith = (
  desc: { packageManagers: readonly PackageManager[]; label: string },
  kind: string,
) =>
(pm: PackageManager) => {
  if (!desc.packageManagers.includes(pm)) {
    throw new Error(
      `The ${desc.label} ${kind} is not available on the ${
        runtimes[pm].label
      } runtime.`,
    );
  }
};
export const readTemplate: (path: string) => string = (path) =>
  Deno.readTextFileSync(join(".", "templates", ...path.split("/")));

export const getInstruction: (
  packageManager: PackageManager,
) => string = (pm) => `
To start the server, run the following command:

  ${getDevCommand(pm)}

Then, try look up an actor from your server:

  ${colors.bold(colors.green("fedify lookup http://localhost:8000/users/john"))}

`;
export const mergeVscSettings = curry(toMerged)(vscodeSettings);

const getDevCommand = (pm: PackageManager) =>
  colors.bold(
    colors.green(
      pm === "deno"
        ? "deno task dev"
        : pm === "bun"
        ? "bun dev"
        : `${pm} run dev`,
    ),
  );

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

export async function addDependencies(
  pm: PackageManager,
  dir: string,
  dependencies: Record<string, string>,
  dev: boolean = false,
): Promise<void> {
  const deps = Object.entries(dependencies)
    .map(([name, version]) =>
      `${
        pm !== "deno" && name.startsWith("npm:")
          ? name.substring(4)
          : pm === "deno" && !name.startsWith("npm:")
          ? `jsr:${name}`
          : name
      }@${
        pm !== "deno" && version.includes("+")
          ? version.substring(0, version.indexOf("+"))
          : version
      }`
    );
  if (deps.length < 1) return;
  const cmd = new Deno.Command(
    pm,
    {
      args: [
        "add",
        ...(dev
          ? [pm === "bun" || pm === "yarn" ? "--dev" : "--save-dev"]
          : []),
        ...uniq(deps),
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

export async function rewriteJsonFile(
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
export function displayFileContent(
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
// Check if directory is empty
export const checkDirectoryEmpty = async (path: string) => {
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
export const getNextInitCommand = (
  pm: PackageManager,
): string[] => [
  ...createNextAppCommand(pm),
  ".",
  "--ts",
  "--app",
  "--skip-install",
];
const createNextAppCommand = (pm: PackageManager): string[] =>
  pm === "deno"
    ? ["deno", "run", "-A", "npm:create-next-app@latest"]
    : pm === "bun"
    ? ["bun", "create", "next-app"]
    : pm === "npm"
    ? ["npx", "create-next-app"]
    : [pm, "dlx", "create-next-app"];
export const getNitroInitCommand = (
  pm: PackageManager,
): string[] => [
  ...createNitroAppCommand(pm),
  pm === "deno" ? "npm:giget@latest" : "giget@latest",
  "nitro",
  ".",
];
const createNitroAppCommand = (pm: PackageManager): string[] =>
  pm === "deno"
    ? ["deno", "run", "-A"]
    : pm === "bun"
    ? ["bunx"]
    : pm === "npm"
    ? ["npx"]
    : [pm, "dlx"];
