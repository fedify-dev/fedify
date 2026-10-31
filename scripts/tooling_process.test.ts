import { deepStrictEqual, equal, rejects, throws } from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { commandOutput, startCommand } from "./tooling_process.ts";

const nodeExecutable =
  process.versions.deno != null || process.versions.bun != null
    ? "node"
    : process.execPath;

test("commands preserve argument boundaries, output and nonzero exit", async () => {
  const args = ["space in argument", "a&b|c", 'quoted"text', "λ"];
  const result = await commandOutput(nodeExecutable, [
    "-e",
    "console.log(JSON.stringify(process.argv.slice(1))); console.error('diagnostic'); process.exitCode = 7;",
    ...args,
  ]);
  equal(result.code, 7);
  equal(result.success, false);
  deepStrictEqual(JSON.parse(new TextDecoder().decode(result.stdout)), args);
  equal(new TextDecoder().decode(result.stderr).trim(), "diagnostic");
});

test("a missing executable rejects rather than hanging or succeeding", async () => {
  await rejects(commandOutput("fedify-no-such-tool-1283", []), {
    code: "ENOENT",
  });
});

test("stopping a command waits for its output and kills descendants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify tooling process "));
  const pidFile = join(dir, "descendant.pid");
  const fixture = join(dir, "parent.cjs");
  await writeFile(
    fixture,
    `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e',
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'
    ], { stdio: 'inherit' });
    require('node:fs').writeFileSync(${
      JSON.stringify(pidFile)
    }, String(child.pid));
    process.on('SIGTERM', () => {});
    console.log('ready');
    setInterval(() => {}, 1000);
  `,
  );
  const child = startCommand(nodeExecutable, [fixture]);
  const reader = child.stdout.getReader();
  const stderr = new Response(child.stderr).text();
  try {
    await reader.read();
    const pid = Number(await readFile(pidFile, "utf8"));
    await child.stop();
    await child.status;
    // Linux may briefly retain a killed, reparented process as a zombie.
    if (process.platform === "linux") {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        equal(stat.split(") ")[1][0], "Z", "descendant is no longer running");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
  } finally {
    await child.stop();
    reader.releaseLock();
    await stderr;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows command shims preserve spaces and shell metacharacters", {
  skip: process.platform !== "win32",
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify command shim "));
  try {
    const script = join(dir, "echo.cjs");
    const shim = join(dir, "echo-args.cmd");
    await writeFile(
      script,
      "console.log(JSON.stringify(process.argv.slice(2)));",
    );
    await writeFile(
      shim,
      `@echo off\r\n"${nodeExecutable}" "${script}" %*\r\n`,
    );
    const args = ["space here", "a&b", "a|b", "percent%value", "caret^value"];
    const result = await commandOutput(shim, args);
    equal(result.code, 0);
    deepStrictEqual(JSON.parse(new TextDecoder().decode(result.stdout)), args);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SIGTERM waits for registered resource cleanup before exiting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify signal cleanup "));
  const marker = join(dir, "cleaned.txt");
  const fixture = join(dir, "signal.mjs");
  await writeFile(
    fixture,
    `
    import { registerCleanup } from ${
      JSON.stringify(import.meta.resolve("./tooling_process.ts"))
    };
    import { writeFile } from 'node:fs/promises';
    registerCleanup(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      await writeFile(${JSON.stringify(marker)}, 'done');
    });
    console.log('ready');
    setInterval(() => {}, 1000);
  `,
  );
  const child = startCommand(nodeExecutable, [
    "--experimental-strip-types",
    fixture,
  ]);
  const reader = child.stdout.getReader();
  const stderr = new Response(child.stderr).text();
  try {
    await reader.read();
    child.child.kill("SIGTERM");
    const status = await child.status;
    if (process.platform !== "win32") {
      equal(status.code, 143);
      equal(await readFile(marker, "utf8"), "done");
    }
  } finally {
    await child.stop();
    reader.releaseLock();
    await stderr;
    await rm(dir, { recursive: true, force: true });
  }
});

test("signal termination retains the conventional exit status", {
  skip: process.platform === "win32",
}, async () => {
  const result = await commandOutput(nodeExecutable, [
    "-e",
    'process.kill(process.pid, "SIGTERM")',
  ]);
  equal(result.code, 143);
  equal(result.success, false);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`a second ${signal} exits during a hung resource cleanup`, {
    skip: process.platform === "win32",
  }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "fedify repeated signal "));
    const fixture = join(dir, "signal.mjs");
    await writeFile(
      fixture,
      `
      import { registerCleanup } from ${
        JSON.stringify(import.meta.resolve("./tooling_process.ts"))
      };
      registerCleanup(async () => {
        console.log('cleaning');
        await new Promise(() => {});
      });
      console.log('ready');
      setInterval(() => {}, 1000);
    `,
    );
    const child = startCommand(nodeExecutable, [
      "--experimental-strip-types",
      fixture,
    ]);
    const reader = child.stdout.getReader();
    const stderr = new Response(child.stderr).text();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const decoder = new TextDecoder();
      equal(decoder.decode((await reader.read()).value).trim(), "ready");
      child.child.kill(signal);
      equal(decoder.decode((await reader.read()).value).trim(), "cleaning");
      child.child.kill(signal);
      const status = await Promise.race([
        child.status,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Second signal ignored")),
            5_000,
          );
        }),
      ]);
      equal(status.code, signal === "SIGINT" ? 130 : 143);
    } finally {
      if (timer != null) clearTimeout(timer);
      await child.stop();
      reader.releaseLock();
      await stderr;
      await rm(dir, { recursive: true, force: true });
    }
  });
}
