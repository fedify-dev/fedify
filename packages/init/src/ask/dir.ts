import { identity, pipe, when } from "@fxts/core";
import { input } from "@inquirer/prompts";
import { message } from "@optique/core/message";
import { printError } from "@optique/run";
import toggle from "inquirer-toggle";
import { getCwd, getOsType, runSubCommand } from "../utils.ts";
import { isDirectoryEmpty, logger } from "../lib.ts";

/**
 * Fills in the project directory by prompting the user if not provided.
 * If the directory is not empty, asks the user whether to use it anyway.
 * If the user agrees, offers to move existing contents to trash.
 * Else, recursively prompts for a new directory until a valid one is provided.
 *
 * @param options - Initialization options possibly containing a directory
 * @returns A promise resolving to options with a guaranteed directory
 */
const fillDir: <T extends { dir?: string }>(
  options: T,
) => Promise<T & { dir: string }> = async (options) => {
  const dir = options.dir ?? await askDir(getCwd());
  return await askIfNonEmpty(dir)
    ? { ...options, dir }
    : await fillDir(options);
};

export default fillDir;

const askDir = (cwd: string) =>
  input({ message: "Project directory:", default: cwd });

const askIfNonEmpty = async (dir: string) => {
  if (await isDirectoryEmpty(dir)) return true;
  if (await askNonEmpty(dir)) return await moveDirToTrash(dir);
  return false;
};

const askNonEmpty = (dir: string) =>
  toggle.default({
    message: `Directory "${dir}" is not empty.
Do you want to use it anyway?`,
    default: false,
  });

const moveDirToTrash = (dir: string) =>
  pipe(dir, askMoveToTrash, when(identity, moveToTrash(dir)));

const askMoveToTrash = (dir: string) =>
  toggle.default({
    message: `Do you want to move the contents of "${dir}" to the trash?
If you choose "No", you should choose another directory.`,
    default: false,
  });

const moveToTrash = (dir: string) => () =>
  pipe(
    getOsType(),
    getTrashCommand,
    (fn) => fn(dir),
    (cmd) => runSubCommand(cmd, { stdio: "ignore" }),
    () => true,
  ).catch((e) => {
    logger.error(e);
    printError(message`Failed to move ${dir} to trash.
Please move it manually.`);
    return false;
  });

const getTrashCommand = (os: NodeJS.Platform) =>
  trashCommands[os as keyof typeof trashCommands] ?? trashCommands.linux;

const trashCommands: Record<
  Extract<NodeJS.Platform, "darwin" | "win32" | "linux">,
  (dir: string) => string[]
> = {
  // mac
  darwin: (dir: string) => ["trash", dir],
  // windows
  win32: (dir: string) => [
    "powershell",
    "-Command",
    getPowershellTrashCommand(dir),
  ],
  // other unix
  linux: (dir: string) => ["rm", "-rf", dir],
};

const getPowershellTrashCommand = (dir: string) =>
  [
    "Add-Type",
    "-AssemblyName",
    "Microsoft.VisualBasic;",
    "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('",
    dir,
    "',",
    "'OnlyErrorDialogs',",
    "'SendToRecycleBin')",
  ].join(" ");
