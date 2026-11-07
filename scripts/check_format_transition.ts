/** Temporary whole-tree formatter transition; remove after normalization. */
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMain } from "./tooling_main.ts";
import { commandOutput } from "./tooling_process.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const generatedPath = "packages/vocab/src/vocab.ts";

interface TransitionOptions {
  cwd?: string;
  run?: typeof commandOutput;
  report?: (message: string) => void;
}

/** Accept one formatter for the entire selection, then check generated code. */
export async function checkFormatTransition(
  paths: string[] = ["."],
  options: TransitionOptions = {},
): Promise<boolean> {
  const run = options.run ?? commandOutput;
  const cwd = options.cwd ?? projectRoot;
  const report = options.report ?? ((message) => console.error(message));
  const failures: string[] = [];
  const check = async (command: string, args: string[]): Promise<boolean> => {
    try {
      const result = await run(command, args, { cwd });
      if (result.success) return true;
      const decoder = new TextDecoder();
      failures.push(
        `${command} ${args.join(" ")} (exit ${result.code})\n` +
          decoder.decode(result.stdout) + decoder.decode(result.stderr),
      );
    } catch (error) {
      failures.push(`${command} ${args.join(" ")}\n${String(error)}`);
    }
    return false;
  };

  // Choose once for the complete tree, never separately for individual files.
  const treeOkay = await check("pnpm", [
    "exec",
    "oxfmt",
    "-c",
    ".oxfmtrc.json",
    "--check",
    ...paths,
  ]) ||
    await check("deno", ["fmt", "--check", ...paths]);
  if (treeOkay) {
    // Oxfmt discovery skips this Git-ignored output. Its existing Deno format
    // remains mandatory until the generator and its checks migrate together.
    failures.length = 0;
    if (await check("deno", ["fmt", "--check", generatedPath])) return true;
  }
  report(failures.join("\n"));
  return false;
}

if (isMain(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (!await checkFormatTransition(paths.length === 0 ? ["."] : paths)) {
    process.exitCode = 1;
  }
}
