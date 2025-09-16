import {
  apply,
  concat,
  entries,
  join,
  map,
  pipe,
  tap,
  unless,
  when,
} from "@fxts/core";
import { stringify } from "@std/dotenv";
import { join as joinPath } from "@std/path";
import { toMerged } from "es-toolkit";
import { readFile } from "node:fs/promises";
import { formatJson, merge, replace, set } from "../../utils.ts";
import { createFile, readTemplate, throwUnlessNotExists } from "../lib.ts";
import biome from "../templates/json/biome.json" with { type: "json" };
import vscodeSettingsForDeno from "../templates/json/vscode-settings-for-deno.json" with {
  type: "json",
};
import vscodeSettings from "../templates/json/vscode-settings.json" with {
  type: "json",
};
import type { InitCommandData, PackageManager } from "../types.ts";
import {
  displayFile,
  recommendCreate,
  recommendInsertJsons,
} from "./notice.ts";
import { isDry, joinDir } from "./utils.ts";

const rewriteJsonFiles = (data: InitCommandData) =>
  pipe(
    data,
    set("files", getFiles),
    set("jsons", getJsons),
    when(isDry, tap(recommendFiles)),
    unless(isDry, tap(createFiles)),
  );

export default rewriteJsonFiles;

interface InitCommandWithFiles extends InitCommandData {
  files: Record<string, string>;
  jsons: Record<string, object>;
}

const getFiles = <
  T extends InitCommandData,
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
  T extends InitCommandData,
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

const recommendFiles = (data: InitCommandWithFiles) =>
  pipe(
    data,
    tap(recommendCreate),
    tap(rewriteFiles(displayFile)),
    tap(recommendInsertJsons),
    set("files", ({ jsons }) => jsons),
    tap(rewriteFiles(displayFile)),
  );

const createFiles = (data: InitCommandWithFiles) =>
  pipe(
    data,
    set("files", ({ jsons, files }) => toMerged(files, jsons)),
    tap(rewriteFiles(createFile)),
  );

const readFederation = (
  {
    imports,
    projectName,
    kv,
    mq,
    packageManager,
  }: InitCommandData & { imports: string },
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
    ? obj.replaceAll(/process\.env\.(\w+)/, (_, g1) => `Deno.env.get("${g1}")`)
    : obj;

const readLogging = ({ projectName }: InitCommandData) =>
  pipe(
    "defaults/logging.ts",
    readTemplate,
    replace(/\/\* project name \*\//, JSON.stringify(projectName)),
  );

const rewriteFiles = (
  process: (path: string, content: string) => void | Promise<void>,
) =>
({ dir, files }: InitCommandWithFiles) =>
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

const rewriteDenoConfig = ({ kv, mq, initializer, dir }: InitCommandData) => ({
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

const rewriteTsConfig = ({ initializer, dir }: InitCommandData) => ({
  path: joinPath(dir, "tsconfig.json"),
  data: {
    compilerOptions: initializer.compilerOptions,
  },
});

const rewritePackageJson = ({ initializer, dir }: InitCommandData) => ({
  path: joinPath(dir, "package.json"),
  data: {
    type: "module",
    scripts: initializer.tasks,
  },
});

const getImports = ({ kv, mq }: InitCommandData) =>
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

async function rewriteFile(
  path: string,
  content: string | object,
): Promise<[string, string]> {
  const prev = await readFileIfExists(path);
  const data = typeof content === "object"
    ? mergeJson(prev, content)
    : appendText(prev, content);
  return [path, data];
}

const mergeJson = (prev: string, data: object): string =>
  pipe(prev ? JSON.parse(prev) : {}, merge(data), formatJson);

const appendText = (prev: string, data: string) =>
  pipe(data.split("\n"), concat(prev.split("\n")), join("\n"));

async function readFileIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    throwUnlessNotExists(e);
    return "";
  }
}

const rewriters = {
  biome: {
    path: joinPath("biome.json"),
    data: biome,
  },
  vscExt: {
    path: joinPath(".vscode", "extensions.json"),
    data: { recommendations: ["biomejs.biome"] },
  },
  vscSet: {
    path: joinPath(".vscode", "settings.json"),
    data: vscodeSettings,
  },
  vscSetDeno: {
    path: joinPath(".vscode", "settings.json"),
    data: vscodeSettingsForDeno,
  },
  vscExtDeno: {
    path: joinPath(".vscode", "extensions.json"),
    data: { recommendations: ["denoland.vscode-deno"] },
  },
} as const;
