import {
  always,
  apply,
  entries,
  join,
  map,
  peek,
  pipe,
  tap,
  toArray,
  unless,
  when,
} from "@fxts/core";
import { message } from "@optique/core";
import { printError } from "@optique/run";
import { stringify } from "@std/dotenv";
import * as colors from "@std/fmt/colors";
import { exists } from "@std/fs";
import { basename, join as joinPath, normalize } from "@std/path";
import { toMerged } from "es-toolkit";
import { mkdir, realpath } from "node:fs/promises";
import process from "node:process";
import {
  match,
  merge,
  notEmpty,
  notEmptyObj,
  replace,
  runSubCommand,
  set,
} from "../utils.ts";
import askOptions from "./ask/mod.ts";
import type { InitCommand } from "./command.ts";
import {
  addDeps,
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
    tap(when(isDry, noticeDry)),
    tap(unless(isDry, makeDirIfHyd)),
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
    when(hasCommand, processCommand),
    tap(rewriteJsonFiles),
    tap(installDependencies),
    tap(recommendConfigEnv),
    tap(howToRun),
  );
}

const processCommand = <
  T extends {
    initializer: WebFrameworkInitializer;
    dir: string;
    dryRun: boolean;
  },
>(data: T) =>
  pipe(
    data,
    when(isDry, tap(recommendPrecommand)),
    unless(isDry, tap(runPrecommand)),
  );

const isDry = <T extends { dryRun: boolean }>({ dryRun }: T) => dryRun;
const hasCommand = <
  T extends { initializer: WebFrameworkInitializer },
>(data: T) => !!data.initializer.command;

function noticeDry() {
  console.log(
    colors.bold(
      colors.yellow("🔍 DRY RUN MODE - No files will be created\n"),
    ),
  );
}

const makeDirIfHyd = <T extends { dir: string }>({ dir }: T) =>
  mkdir(dir, { recursive: true });

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

const installDependencies = <
  T extends {
    packageManager: PackageManager;
    dir: string;
    dryRun: boolean;
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
  },
>(data: T) =>
  pipe(
    data,
    tap(installDeps),
    unless(isDeno, tap(installDevDeps)),
  );

const installDeps = <
  T extends {
    packageManager: PackageManager;
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
    dryRun: boolean;
    dir: string;
  },
>(data: T) =>
  pipe(
    data,
    set("dependencies", getDependencies),
    when(isDry, tap(recommendInstallDeps)),
    unless(isDry, tap(addDeps)),
  );

const installDevDeps = <
  T extends {
    packageManager: PackageManager;
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
  },
>(data: T) =>
  pipe(
    data,
    set("dependencies", getDevDependencies),
    set("dev", always(true)),
    when(isDry, tap(recommendInstallDeps)),
    unless(isDry, tap(addDeps)),
  );

const isDeno = <T extends { packageManager: PackageManager }>(
  { packageManager }: T,
) => packageManager === "deno";

const getDependencies = <
  T extends {
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
  },
>({ initializer, kv, mq }: T): Record<string, string> =>
  pipe(
    {
      "@fedify/fedify": PACKAGE_VERSION,
      "@logtape/logtape": "^1.1.0",
    },
    merge(initializer.dependencies),
    merge(kv.dependencies),
    merge(mq.dependencies),
  );

const getDevDependencies = <
  T extends {
    initializer: WebFrameworkInitializer;
    kv: KvStoreDescription;
    mq: MessageQueueDescription;
  },
>({ initializer, kv, mq }: T): Record<string, string> =>
  pipe(
    {
      "@biomejs/biome": "^1.8.3",
    },
    merge(initializer.devDependencies),
    merge(kv.devDependencies),
    merge(mq.devDependencies),
  );

const recommendInstallDeps = <
  T extends { dependencies: Record<string, string>; dev?: boolean },
>({ dependencies, dev }: T) =>
  pipe(
    dependencies,
    when(notEmptyObj, tap(recommendInstall(dev))),
  );

const recommendInstall = (dev = false) =>
  function (dependencies: Record<string, string>) {
    const deps = pipe(
      dependencies,
      entries,
      map(([name, version]) => `${name}@${version}`),
      join("\n"),
    );
    console.log(
      colors.bold(
        colors.cyan(`📦 Would install ${dev ? "dev " : ""}dependencies:`),
      ),
    );
    console.log(`${deps}\n`);
  };

const rewriteJsonFiles = <
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
>(data: T) =>
  pipe(
    data,
    set("files", getFiles),
    set("jsons", getJsons),
    match(isDry, recommendFiles, createFiles),
  );

const recommendFiles = <
  T extends {
    dir: string;
    files: Record<string, string | object>;
    jsons: Record<string, object>;
  },
>(data: T) =>
  pipe(
    data,
    tap(recommendCreate),
    tap(rewriteFiles(displayFile)),
    tap(recommendInsertJsons),
    set("files", ({ jsons }) => jsons),
    tap(rewriteFiles(displayFile)),
  );
const createFiles = <
  T extends {
    dir: string;
    files: Record<string, string | object>;
    jsons: Record<string, object>;
  },
>(data: T) =>
  pipe(
    data,
    set("files", ({ jsons, files }) => toMerged(files, jsons)),
    tap(rewriteFiles(createFile)),
  );

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
>(data: T): Record<string, object> =>
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
    [joinPath(dir, ...filename.split("/")), content] as [
      string,
      string | object,
    ];

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
        apply(rewriteFile),
        apply(process),
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
    map(([module, { "default": defaultImport = "", ...imports }]) => //
    [module, defaultImport, getAlias(imports)]),
    map(([module, defaultImport, namedImports]) =>
      `import ${
        [defaultImport, namedImports.length > 0 ? `{ ${namedImports} }` : ""]
          .filter((x) => x.length > 0)
          .join(", ")
      } from ${JSON.stringify(module)};`
    ),
    join("\n"),
  );

const getAlias = (imports: Record<string, string>) =>
  pipe(
    imports,
    entries,
    map(([name, alias]) => name === alias ? name : `${name} as ${alias}`),
    join(", "),
  );

const recommendConfigEnv = <T extends { env: Record<string, string> }>(
  { env }: T,
) =>
  pipe(
    env,
    entries,
    toArray,
    tap(when(notEmpty, noticeConfigEnv)),
    peek(([key, value]) => printError(message`${key}=${value}`)),
  );

const noticeConfigEnv = () =>
  printError(
    message`Note that you probably want to edit the ${".env"} file.  It currently contains the following values:\n`,
  );

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
