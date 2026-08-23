import $ from "@david/dax";
import { identity, pipe, when } from "@fxts/core";
import { input } from "@inquirer/prompts";
import { type Message, message } from "@optique/core/message";
import { printError } from "@optique/run";
import toggle from "inquirer-toggle";
import { isDirectoryEmpty, logger } from "../lib.ts";
import { getCwd, getOsType } from "../utils.ts";

/**
 * Fills in the project directory by prompting the user if not provided.
 * If the directory is not empty, asks the user whether to use it anyway.
 * If the user agrees, offers to move existing contents to trash.
 * Else, recursively prompts for a new directory until a valid one is provided.
 *
 * @param options - Initialization options possibly containing a directory
 * @returns A promise resolving to options with a guaranteed directory
 */
const fillDir: <T extends { allowNonEmpty: boolean; dir?: string }>(
  options: T,
) => Promise<T & { dir: string }> = async (options) => {
  const dir = options.dir ?? await askDir(getCwd());
  if (options.allowNonEmpty) return { ...options, dir };
  return await askIfNonEmpty(dir)
    ? { ...options, dir }
    : await fillDir(options);
};

export default fillDir;

type DirActionMode = "trash" | "permanent";

const askDir = (cwd: string) =>
  input({ message: "Project directory:", default: cwd });

const askIfNonEmpty = async (dir: string) => {
  if (await isDirectoryEmpty(dir)) return true;
  if (await askNonEmpty(dir)) return await moveOrDeleteDir(dir);
  return false;
};

const askNonEmpty = (dir: string) =>
  toggle.default({
    message: `Directory "${dir}" is not empty.
Do you want to use it anyway?`,
    default: false,
  });

const moveOrDeleteDir = (dir: string) =>
  pipe(
    dir,
    buildMoveOrDelete,
    (action) =>
      pipe(
        action.confirm,
        when(identity, runAction(action.command, action.error)),
      ),
  );

const buildMoveOrDelete = (dir: string) =>
  pipe(
    getOsType(),
    detectSupportedAction,
    (fn) => {
      return {
        confirm: fn.confirmAction(dir),
        command: fn.actionPlan.command(dir),
        error: errorMessages[fn.actionPlan.mode](dir),
      };
    },
  );

const detectSupportedAction = (os: NodeJS.Platform) => {
  const actionPlan =
    trashOrDeleteCommands[os as keyof typeof trashOrDeleteCommands] ??
      trashOrDeleteCommands.linux;

  return {
    confirmAction: (actionPlan.mode === "trash")
      ? moveToTrashConfirm
      : deletePermanentlyConfirm,
    actionPlan,
  };
};

const moveToTrashConfirm = (dir: string) =>
  toggle.default({
    message: `Do you want to move the contents of "${dir}" to the trash?
If you choose "No", you should choose another directory.`,
    default: false,
  });

const deletePermanentlyConfirm = (dir: string) =>
  toggle.default({
    message: `Do you really want to delete all contents of "${dir}" PERMANENTLY?
If you choose "No", you should choose another directory.`,
    default: false,
  });

const runAction = (command: string[], error: Message) => () =>
  pipe(
    command,
    (cmd) => $`${cmd}`.spawn(),
    () => true,
  ).catch((e) => {
    logger.error(e);
    printError(error);
    return false;
  });

const trashOrDeleteCommands: Record<
  Extract<NodeJS.Platform, "darwin" | "win32" | "linux">,
  { mode: DirActionMode; command: (dir: string) => string[] }
> = {
  // mac
  darwin: {
    mode: "trash",
    command: (dir: string) => ["trash", dir],
  },
  // windows
  win32: {
    mode: "trash",
    command: (dir: string) => [
      "powershell",
      "-Command",
      getPowershellTrashCommand(dir),
    ],
  },
  // other unix
  linux: {
    mode: "permanent",
    command: (dir: string) => ["rm", "-rf", dir],
  },
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

const errorMessages: Record<DirActionMode, (dir: string) => Message> = {
  "trash": (dir: string) =>
    message`Failed to move ${dir} to trash.
Please move it manually.`,
  "permanent": (dir: string) =>
    message`Failed to delete ${dir} permanently.
Please remove it manually.`,
};
