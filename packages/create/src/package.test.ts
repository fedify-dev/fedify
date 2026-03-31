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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

function getNodeCommand(): string {
  return "Deno" in globalThis || "Bun" in globalThis
    ? "node"
    : process.execPath;
}

test("package.json entrypoints match built create CLI", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(packageDir, "package.json"), "utf8"),
  );
  const binTarget = packageJson.bin["@fedify/create"] as string;
  const exportTarget = packageJson.exports as string;
  await access(resolve(packageDir, binTarget));
  await access(resolve(packageDir, exportTarget));

  const result = await runCommand(getNodeCommand(), [
    resolve(packageDir, binTarget),
    "--help",
  ]);
  strictEqual(result.code, 0, result.stderr);
  match(result.stdout, /Create a new Fedify project/);
});
