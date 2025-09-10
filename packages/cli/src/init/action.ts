import { entries, join, map, pipe, tap } from "@fxts/core";
import { stringify } from "@std/dotenv";
import * as colors from "@std/fmt/colors";
import { exists } from "@std/fs";
import { basename, dirname, join as joinPath, normalize } from "@std/path";
import { toMerged, uniq } from "jsr:@es-toolkit/es-toolkit";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import process from "node:process";
import {
  isNotFoundError,
  merge,
  replace,
  runSubCommand,
  set,
} from "../utils.ts";
import askOptions from "./ask.ts";
import type { InitCommand } from "./command.ts";
import {
  addDependencies,
  checkDirectoryEmpty,
  displayFileContent,
  drawDinosaur,
  kvStores,
  logOptions,
  mergeVscSettings,
  messageQueues,
  PACKAGE_VERSION,
  readTemplate,
  rewriteJsonFile,
} from "./lib.ts";
import type {
  KvStoreDescription,
  MessageQueueDescription,
  PackageManager,
  WebFramework,
  WebFrameworkInitializer,
} from "./types.ts";
import webFrameworks from "./webframeworks.ts";

export default async function runInit(options: InitCommand) {
  drawDinosaur();
  const input = await pipe(
    options,
    askOptions,
    tap(logOptions),
    tap(noticeDryRun),
    tap(checkDirectory),
  );
  const data = await pipe(
    input,
    set("projectName", getProjectName),
    set("initializer", getInitializer),
    set("kv", ({ kvStore }) => kvStores[kvStore]),
    set("mq", ({ messageQueue }) => messageQueues[messageQueue]),
    set("env", ({ kv, mq }) => merge(kv.env)(mq.env)),
  );
  pipe(
    data,
    tap(precommand),
    tap(checkPackageJson),
    tap(installDependencies),
    tap(rewriteJsonFiles),
    tap(configEnv),
    tap(howToRun),
  );
}

function noticeDryRun<T extends { dryRun: boolean }>({ dryRun }: T) {
  if (dryRun) {
    console.log(
      colors.bold(
        colors.yellow("🔍 DRY RUN MODE - No files will be created\n"),
      ),
    );
  }
}

async function checkDirectory<T extends { dir: string; dryRun: boolean }>(
  { dir, dryRun }: T,
) {
  if (dryRun) {
    await checkDirectoryEmpty(dir);
  } else {
    await mkdir(dir, { recursive: true });
    await checkDirectoryEmpty(dir);
  }
}

const getInitializer = <
  T extends {
    webFramework: WebFramework;
    projectName: string;
    packageManager: PackageManager;
  },
>({
  webFramework,
  projectName,
  packageManager,
}: T) =>
  webFrameworks[webFramework].init(
    projectName,
    packageManager,
  );

const getProjectName: <T extends { dir: string }>({ dir }: T) => //
Promise<string> = async ({ dir }) =>
  basename(await exists(dir) ? await realpath(dir) : normalize(dir));

async function precommand<
  T extends {
    initializer: WebFrameworkInitializer;
    dir: string;
    dryRun: boolean;
  },
>({
  initializer: { command },
  dir,
  dryRun,
}: T) {
  if (command != null) {
    if (dryRun) {
      console.log(colors.bold(colors.cyan("📦 Would run command:")));
      console.log(`  ${command.join(" ")}\n`);
    } else {
      await runSubCommand(command, {
        cwd: dir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).catch(() => {
        console.error("Failed to initialize the project.");
        process.exit(1);
      });
    }
  }
}

async function checkPackageJson<
  T extends {
    packageManager: PackageManager;
    dir: string;
    dryRun: boolean;
  },
>({ packageManager, dir, dryRun }: T): Promise<void> {
  if (packageManager !== "deno") {
    const packageJsonPath = joinPath(dir, "package.json");
    if (!dryRun) {
      try {
        await stat(packageJsonPath);
      } catch (e) {
        if (isNotFoundError(e)) {
          await writeTextFile(packageJsonPath, "{}");
        } else throw e;
      }
    }
  }
}

async function installDependencies<
  T extends {
    packageManager: PackageManager;
    dir: string;
    dryRun: boolean;
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
  },
>({
  packageManager: pm,
  dir,
  dryRun,
  initializer,
  kv,
  mq,
}: T): Promise<void> {
  const dependencies: Record<string, string> = {
    "@fedify/fedify": PACKAGE_VERSION,
    "@logtape/logtape": "^0.8.2",
    ...initializer.dependencies,
    ...kv?.dependencies,
    ...mq?.dependencies,
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
      pm,
      dir,
      dependencies,
    );
  }
  if (pm !== "deno") {
    const devDependencies: Record<string, string> = {
      "@biomejs/biome": "^1.8.3",
      ...initializer.devDependencies,
      ...kv?.devDependencies,
      ...mq?.devDependencies,
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
        pm,
        dir,
        devDependencies,
        true,
      );
    }
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  return await writeFile(path, data);
}

async function rewriteJsonFiles<
  T extends {
    dir: string;
    dryRun: boolean;
    packageManager: PackageManager;
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
    env: Record<string, string>;
    projectName: string;
  },
>(
  { dir, dryRun, packageManager, initializer, kv, mq, env, projectName }: T,
): Promise<void> {
  const federation = readFederation({
    imports: getImports({ kv, mq }),
    projectName,
    kv,
    mq,
    packageManager,
  });
  const logging = readLogging({ projectName });
  const files = {
    [initializer.federationFile]: federation,
    [initializer.loggingFile]: logging,
    ".env": stringify(env),
    ...initializer.files,
  };
  if (dryRun) {
    console.log(colors.bold(colors.green("📄 Would create files:\n")));
    for (const [filename, content] of Object.entries(files)) {
      const path = joinPath(dir, filename);
      displayFileContent(path, content);
    }
  } else {
    for (const [filename, content] of Object.entries(files)) {
      const path = joinPath(dir, filename);
      const dirName = dirname(path);
      await mkdir(dirName, { recursive: true });
      await writeTextFile(path, content);
    }
  }
  if (packageManager === "deno") {
    if (dryRun) {
      console.log(
        colors.bold(colors.green("Would create/update JSON files:\n")),
      );
    }
    await rewriteJsonFile(
      joinPath(dir, "deno.json"),
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
          ...kv.denoUnstable ?? [],
          ...mq.denoUnstable ?? [],
        ],
        tasks: { ...cfg.tasks, ...initializer.tasks },
      }),
      dryRun,
    );
    await rewriteJsonFile(
      joinPath(dir, ".vscode", "settings.json"),
      {},
      mergeVscSettings,
      dryRun,
    );
    await rewriteJsonFile(
      joinPath(dir, ".vscode", "extensions.json"),
      {},
      (vsCodeExtensions) => ({
        recommendations: uniq([
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
      joinPath(dir, "package.json"),
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
        joinPath(dir, "tsconfig.json"),
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
      joinPath(dir, ".vscode", "settings.json"),
      {},
      mergeVscSettings,
      dryRun,
    );
    await rewriteJsonFile(
      joinPath(dir, ".vscode", "extensions.json"),
      {},
      (vsCodeExtensions) => ({
        recommendations: uniq([
          "biomejs.biome",
          ...vsCodeExtensions.recommendations ?? [],
        ]),
        ...vsCodeExtensions,
      }),
      dryRun,
    );
    await rewriteJsonFile(
      joinPath(dir, "biome.json"),
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
}

const getImports = <
  T extends { kv: KvStoreDescription; mq: MessageQueueDescription },
>({ kv, mq }: T) =>
  pipe(
    toMerged(kv.imports, mq.imports),
    entries,
    map((
      [module, { "default": defaultImport = "", ...imports }],
    ) => [
      module,
      defaultImport,
      Object.entries(imports).map(
        ([name, alias]) => name === alias ? name : `${name} as ${alias}`,
      )
        .join(", "),
    ]),
    map(([module, defaultImport, namedImports]) =>
      `import ${
        [defaultImport, namedImports.length > 0 ? `{ ${namedImports} }` : ""]
          .filter((x) => x.length > 0)
          .join(", ")
      } from ${JSON.stringify(module)};`
    ),
    join("\n"),
  );

function configEnv<T extends { env: Record<string, string> }>(
  { env }: T,
): void {
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
}

function howToRun<T extends { initializer: WebFrameworkInitializer }>(
  { initializer: { instruction, federationFile } }: T,
) {
  console.error(instruction);
  console.error(`\
Start by editing the ${colors.bold(colors.blue(federationFile))} \
file to define your federation!
`);
}

const readFederation = <
  T extends {
    imports: string;
    projectName: string;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
    packageManager: PackageManager;
  },
>(
  {
    imports,
    projectName,
    kv,
    mq,
    packageManager,
  }: T,
) =>
  pipe(
    "defaults/federation.ts",
    readTemplate,
    replace(/\/\* imports \*\//, imports),
    replace(/\/\* logger \*\//, JSON.stringify(projectName)),
    replace(/\/\* kv \*\//, convertEnv(kv.object, packageManager)),
    replace(/\/\* queue \*\//, convertEnv(mq.object, packageManager)),
  );
const convertEnv = (obj: string, pm: PackageManager) =>
  pm === "deno" && /process\.env\.(\w+)/.test(obj)
    ? obj.replace(/process\.env\.(\w+)/, (_, g1) => `Deno.env.get("${g1}")`)
    : obj;

const readLogging = <T extends { projectName: string }>({ projectName }: T) =>
  pipe(
    "defaults/logging.ts",
    readTemplate,
    replace(/\/\* project name \*\//, JSON.stringify(projectName)),
  );
