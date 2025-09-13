import { entries, join, map, pipe, tap } from "@fxts/core";
import { stringify } from "@std/dotenv";
import * as colors from "@std/fmt/colors";
import { exists } from "@std/fs";
import { basename, join as joinPath, normalize } from "@std/path";
import { toMerged } from "jsr:@es-toolkit/es-toolkit";
import { mkdir, realpath, stat } from "node:fs/promises";
import process from "node:process";
import {
  isNotFoundError,
  merge,
  replace,
  runSubCommand,
  set,
  spreadArgs,
  writeTextFile,
} from "../utils.ts";
import askOptions from "./ask/mod.ts";
import type { InitCommand } from "./command.ts";
import {
  addDependencies,
  createFile,
  displayFile,
  drawDinosaur,
  kvStores,
  logOptions,
  messageQueues,
  PACKAGE_VERSION,
  readTemplate,
  rewriteFile,
  rewriters,
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
    tap(noticeDry),
    tap(makeDirIfHyd),
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

function noticeDry<T extends { dryRun: boolean }>({ dryRun }: T) {
  if (dryRun) {
    console.log(
      colors.bold(
        colors.yellow("🔍 DRY RUN MODE - No files will be created\n"),
      ),
    );
  }
}

async function makeDirIfHyd<T extends { dir: string; dryRun: boolean }>(
  { dir, dryRun }: T,
) {
  if (!dryRun) {
    await mkdir(dir, { recursive: true });
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
>(data: T) {
  if (data.initializer.command) {
    if (data.dryRun) {
      recommendPrecommand(data);
    } else {
      await runPrecommand(data);
    }
  }
}

function recommendPrecommand<
  T extends {
    initializer: WebFrameworkInitializer;
    dir: string;
  },
>({
  initializer: { command },
  dir,
}: T) {
  console.log(colors.bold(colors.cyan("📦 Would run command:")));
  console.log(`  cd ${dir}`);
  console.log(`  ${command!.join(" ")}\n`);
}
async function runPrecommand<
  T extends {
    initializer: WebFrameworkInitializer;
    dir: string;
  },
>({
  initializer: { command },
  dir,
}: T) {
  await runSubCommand(command!, {
    cwd: dir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).catch(() => {
    console.error("Failed to initialize the project.");
    process.exit(1);
  });
}

async function checkPackageJson<
  T extends { dir: string },
>({ dir }: T): Promise<void> {
  const packageJsonPath = joinPath(dir, "package.json");
  try {
    await stat(packageJsonPath);
  } catch (e) {
    if (isNotFoundError(e)) {
      await writeTextFile(packageJsonPath, "{}");
    } else throw e;
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
  packageManager,
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
    recommendInstall({ dependencies });
  } else {
    await addDependencies(packageManager, dir, dependencies);
  }
  if (packageManager !== "deno") {
    installDevDependencies({
      packageManager,
      dir,
      dryRun,
      initializer,
      kv,
      mq,
    });
  }
}

async function installDevDependencies<
  T extends {
    packageManager: PackageManager;
    dir: string;
    dryRun: boolean;
    initializer: WebFrameworkInitializer;
    kv?: KvStoreDescription;
    mq?: MessageQueueDescription;
  },
>({ packageManager: pm, dir, dryRun, initializer, kv, mq }: T): Promise<void> {
  const dependencies: Record<string, string> = {
    "@biomejs/biome": "^1.8.3",
    ...initializer.devDependencies,
    ...kv?.devDependencies,
    ...mq?.devDependencies,
  };
  if (dryRun) {
    recommendInstall({ dependencies, dev: true });
  } else {
    await addDependencies(pm, dir, dependencies, true);
  }
}

function recommendInstall<
  T extends { dependencies: Record<string, string>; dev?: boolean },
>(
  { dependencies, dev = false }: T,
) {
  const deps = Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version}`)
    .join("\n");
  if (deps) {
    console.log(
      colors.bold(
        colors.cyan(`📦 Would install ${dev ? "dev " : ""}dependencies:`),
      ),
    );
    console.log(`${deps}\n`);
  }
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
>(data: T): Promise<void> {
  const { dir, dryRun } = data;
  const files = getFiles(data);
  const jsons = getJsons(data);

  if (dryRun) {
    recommendCreate();
    rewriteFiles(displayFile)({ dir, files });
    recommendInsertJsons();
    rewriteFiles(displayFile)({ dir, files: jsons });
  } else {
    await Array.fromAsync(rewriteFiles(createFile)({ dir, files }));
    await Array.fromAsync(rewriteFiles(createFile)({ dir, files: jsons }));
  }
}

const getFiles = <
  T extends {
    dir: string;
    initializer: WebFrameworkInitializer;
    env: Record<string, string>;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
    packageManager: PackageManager;
    projectName: string;
  },
>(data: T) => ({
  [data.initializer.federationFile]: readFederation({
    imports: getImports(data),
    ...data,
  }),
  [data.initializer.loggingFile]: readLogging(data),
  ".env": stringify(data.env),
  ...data.initializer.files,
});

const getJsons = <
  T extends {
    packageManager: PackageManager;
    dir: string;
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
  },
>(data: T) =>
  data.packageManager === "deno"
    ? {
      "deno.json": rewriteDenoConfig(data).data,
      [rewriters["vscSetDeno"].path]: rewriters["vscSetDeno"].data,
      [rewriters["vscExtDeno"].path]: rewriters["vscExtDeno"].data,
    }
    : {
      "tsconfig.json": rewriteTsConfig(data).data,
      "package.json": rewritePackageJson(data).data,
      [rewriters["biome"].path]: rewriters["biome"].data,
      [rewriters["vscSet"].path]: rewriters["vscSet"].data,
      [rewriters["vscExt"].path]: rewriters["vscExt"].data,
    };

const recommendCreate = () =>
  console.log(colors.bold(colors.green("📄 Would create files:\n")));

const recommendInsertJsons = () =>
  console.log(
    colors.bold(colors.green("Would create/update JSON files:\n")),
  );

const joinDir =
  (dir: string) => ([filename, content]: readonly [string, string | object]) =>
    [joinPath(dir, ...filename.split("/")), content] as const;

const rewriteFiles = (
  process: (path: string, content: string) => void | Promise<void>,
) =>
<
  T extends { dir: string; files: Record<string, string | object> },
>({ dir, files }: T) =>
  pipe(
    files,
    entries,
    map((i) =>
      pipe(
        i,
        joinDir(dir),
        spreadArgs(rewriteFile),
        spreadArgs(process),
      )
    ),
  );

const rewriteDenoConfig = <
  T extends {
    dir: string;
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
  },
>({ kv, mq, initializer, dir }: T) => ({
  path: joinPath(dir, "deno.json"),
  data: {
    compilerOptions: initializer.compilerOptions,
  },
  unstable: [
    "temporal",
    ...kv.denoUnstable ?? [],
    ...mq.denoUnstable ?? [],
  ],
  tasks: initializer.tasks,
});

const rewriteTsConfig = <
  T extends { initializer: WebFrameworkInitializer; dir: string },
>({ initializer, dir }: T) => ({
  path: joinPath(dir, "tsconfig.json"),
  data: {
    compilerOptions: initializer.compilerOptions,
  },
});

const rewritePackageJson = <
  T extends { initializer: WebFrameworkInitializer; dir: string },
>({ initializer, dir }: T) => ({
  path: joinPath(dir, "package.json"),
  data: {
    type: "module",
    scripts: initializer.tasks,
  },
});

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
