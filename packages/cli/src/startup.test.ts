import { match, strictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function runCommand(
  command: string,
  args: string[],
): Promise<
  {
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }
> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: packageDir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function getNodeCommand(): string {
  return "Deno" in globalThis || "Bun" in globalThis
    ? "node"
    : process.execPath;
}

test("CLI build keeps the init command bridge", async () => {
  const entrypoint = resolve(packageDir, "dist/mod.js");
  const commandBridge = resolve(packageDir, "dist/commands.js");
  await access(entrypoint);
  await access(commandBridge);

  const bridgeSource = await readFile(commandBridge, "utf8");
  match(bridgeSource, /@fedify\/init/);
});

test("CLI starts successfully with --help", { timeout: 60_000 }, async () => {
  const result = await runCommand(getNodeCommand(), [
    resolve(packageDir, "dist/mod.js"),
    "--help",
  ]);
  strictEqual(
    result.code,
    0,
    `exited with signal ${result.signal}; stderr: ${result.stderr}`,
  );
  match(result.stdout, /fedify/);
});
