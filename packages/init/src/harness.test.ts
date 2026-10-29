import { nodeExecutable } from "./test/node.ts";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import createTestApp, { genInitCommand } from "./test/create.ts";
import lookup, { sendLookup } from "./test/lookup.ts";
import {
  isPortInUse,
  parseWindowsListeners,
  reservePort,
} from "./test/port.ts";
import runTests from "./test/run.ts";
import { serverClosure } from "./test/server.ts";
import type { InitTestData } from "./test/types.ts";

const options: InitTestData = {
  webFramework: ["hono"],
  packageManager: ["npm"],
  kvStore: ["in-memory"],
  messageQueue: ["in-process"],
  dryRun: true,
  hydRun: true,
  testDirPrefix: "/unused",
  runId: "regression",
};

test("initializer harness runs through a symlinked directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify init entry "));
  try {
    await symlink(
      fileURLToPath(new URL("./test/", import.meta.url)),
      join(dir, "linked"),
      "junction",
    );
    const { stdout } = await promisify(execFile)(nodeExecutable, [
      "--experimental-transform-types",
      join(dir, "linked", "mod.ts"),
      "--help",
    ]);
    equal(stdout.includes("fedify-test-init"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("initializer generation executes the Node source entry", () => {
  const command = [
    ...genInitCommand("a directory", true, [
      "hono",
      "npm",
      "in-memory",
      "in-process",
    ]),
  ];
  equal(command[0], nodeExecutable);
  deepStrictEqual(command.slice(1, 5), [
    "--experimental-transform-types",
    "src/test/execute.ts",
    "init",
    "a directory",
  ]);
});

test("generation and lookup failures propagate through the aggregate", async () => {
  const failedCreate = {
    create: () => Promise.resolve(""),
    lookup: () => Promise.resolve(true),
  };
  equal(await runTests(true, failedCreate)(options), false);
  equal(await runTests(false, failedCreate)(options), false);
  equal(
    await runTests(false, {
      create: () => Promise.resolve("/generated"),
      lookup: () => Promise.resolve(false),
    })(options),
    false,
  );
  equal(
    await runTests(false, {
      create: () => Promise.resolve("/generated"),
      lookup: () => Promise.resolve(true),
    })(options),
    true,
  );
  equal(
    await lookup(
      [join("/tmp", "hono", "npm", "in-memory", "in-process")],
      () => Promise.resolve(false),
    ),
    false,
  );
});

test("an entirely filtered matrix fails without generating any apps", async () => {
  for (const dry of [true, false]) {
    let generated = 0;
    equal(
      await runTests(dry, {
        create: () => {
          generated++;
          return Promise.resolve("/generated");
        },
        lookup: () => Promise.resolve(true),
      })({ ...options, webFramework: ["next"], kvStore: ["denokv"] }),
      false,
    );
    equal(generated, 0);
  }
});

test("lookup fails when no eligible directories remain", async () => {
  const skipped = join(tmpdir(), "next", "npm", "in-memory", "in-process");
  const eligible = join(tmpdir(), "hono", "npm", "in-memory", "in-process");
  const tested: string[] = [];
  const testApp = (dir: string) => {
    tested.push(dir);
    return Promise.resolve(true);
  };
  for (const dirs of [[], [""], [skipped]]) {
    equal(await lookup(dirs, testApp), false);
    deepStrictEqual(tested, []);
  }
  equal(await lookup([skipped, eligible], testApp), true);
  deepStrictEqual(tested, [eligible]);
});

test("an actual failed generation returns a failed result", async () => {
  const prefix = await mkdtemp(join(tmpdir(), "fedify failed generation "));
  const testCase = ["hono", "npm", "in-memory", "in-process"] as const;
  const dir = join(prefix, ...testCase);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "existing.txt"), "preserve me");
    equal(await createTestApp(prefix, false)([...testCase]), "");
    equal(await readFile(join(dir, "existing.txt"), "utf8"), "preserve me");
    equal((await readFile(join(dir, "err.txt"), "utf8")).length > 0, true);
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});

test("lookup requires a successful exit even with expected stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify lookup "));
  const server = createServer((_request, response) => response.end("ready"));
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("No address");
  }
  const script = join(dir, "fake cli.mjs");
  try {
    for (const code of [0, 1]) {
      await writeFile(
        script,
        `console.log("id: URL 'http://localhost:${address.port}/users/john',"); process.exitCode = ${code};`,
      );
      equal(await sendLookup(address.port, script), code === 0);
    }
    await writeFile(script, "process.exitCode = 2;");
    equal(await sendLookup(address.port, script), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("server spawn and early exit failures reject without calling lookup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify spawn "));
  try {
    await rejects(
      serverClosure(
        dir,
        [join(dir, "missing executable")],
        12345,
        () => Promise.reject(new Error("lookup called")),
      ),
      /ENOENT/,
    );
    await rejects(
      serverClosure(
        dir,
        [
          nodeExecutable,
          "-e",
          "console.error('startup failed'); process.exit(2)",
        ],
        12345,
        () => Promise.reject(new Error("lookup called")),
      ),
      /Server exited/,
    );
    equal(
      (await readFile(join(dir, "err.txt"), "utf8")).includes("startup failed"),
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("server cancellation kills descendants and retains log output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify tree & spaces "));
  const { port, release } = await reservePort();
  const controller = new AbortController();
  const childCode =
    `require('node:http').createServer((q,s)=>s.end('ok')).listen(${port},()=>console.log('port ${port}')); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`;
  const script = join(dir, "server & launcher.cjs");
  await writeFile(
    script,
    `require('node:child_process').spawn(process.execPath,['-e',${
      JSON.stringify(childCode)
    }],{stdio:'inherit'}); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`,
  );
  try {
    await rejects(
      serverClosure(
        dir,
        [nodeExecutable, script],
        port,
        async () => {
          equal(await isPortInUse(port), true);
          controller.abort(new Error("cancel requested"));
          await new Promise(() => {});
        },
        release,
        controller.signal,
      ),
      /cancel requested/,
    );
    equal(await isPortInUse(port), false);
    equal(
      (await readFile(join(dir, "out.txt"), "utf8")).includes(`port ${port}`),
      true,
    );
  } finally {
    controller.abort();
    await release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("server cleanup also runs when the callback fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify callback "));
  const { port, release } = await reservePort();
  try {
    await rejects(
      serverClosure(
        dir,
        [
          nodeExecutable,
          "-e",
          `require('node:net').createServer().listen(${port},()=>console.log('port ${port}'));`,
        ],
        port,
        () => Promise.reject(new Error("lookup failed")),
        release,
      ),
      /lookup failed/,
    );
    equal(await isPortInUse(port), false);
  } finally {
    await release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows listener parsing matches the requested listening port", () => {
  deepStrictEqual(
    parseWindowsListeners(
      `
  TCP    0.0.0.0:3000     0.0.0.0:0      LISTENING       123
  TCP    [::]:3000        [::]:0         LISTENING       123
  TCP    127.0.0.1:13000  0.0.0.0:0      LISTENING       456
  TCP    127.0.0.1:3000   127.0.0.1:123  ESTABLISHED     789
`,
      3000,
    ),
    ["123", "123"],
  );
});

const windowsTest = process.platform === "win32" ? test : test.skip;

windowsTest(
  "Windows command shims preserve spaces and shell metacharacters",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "fedify shim & spaces "));
    const { port, release } = await reservePort();
    const script = join(dir, "server.cjs");
    const shim = join(dir, "server shim.cmd");
    const argument = "spaces & echoed | < > ^ %value% !value!";
    try {
      await writeFile(
        script,
        `console.log(JSON.stringify(process.argv.slice(2))); require('node:net').createServer().listen(${port},()=>console.log('port ${port}'));`,
      );
      await writeFile(
        shim,
        `@echo off\r\n"${nodeExecutable}" "${script}" %*\r\n`,
      );
      await serverClosure(dir, [shim, argument], port, async () => {
        await delay(10);
        return true;
      }, release);
      equal(
        (await readFile(join(dir, "out.txt"), "utf8")).includes(
          JSON.stringify([argument]),
        ),
        true,
      );
    } finally {
      await release();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("explicit npm test cases avoid other runtimes while the public CLI checks them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fedify runtime probes "));
  const log = join(dir, "probes.log");
  const invoke = promisify(execFile);
  const fixture = join(dir, "runtime-probes.mjs");
  try {
    // Observe runtime checks without depending on Windows shell-shim support.
    await writeFile(
      fixture,
      `
      import { runtimes } from ${
        JSON.stringify(new URL("./lib.ts", import.meta.url).href)
      };
      const log = ${JSON.stringify(log)};
      for (const name of ['deno', 'bun']) {
        const version = (name === 'deno' ? 'deno ' : '') + runtimes[name].minVersion;
        runtimes[name].checkCommand = [process.execPath, '-e',
          'setTimeout(() => { require("node:fs").appendFileSync(' + JSON.stringify(log) +
          ', ' + JSON.stringify(name + '\\n') + '); console.log(' + JSON.stringify(version) + '); }, ' +
          (name === 'bun' ? 250 : 0) + ');'];
      }
      await import(${
        JSON.stringify(new URL("./test/execute.ts", import.meta.url).href)
      });
      `,
    );
    const args = [
      "--experimental-transform-types",
      fixture,
      "init",
      join(dir, "app"),
      "-w",
      "hono",
      "-p",
      "npm",
      "-k",
      "in-memory",
      "-m",
      "in-process",
      "--dry-run",
    ];
    await invoke(nodeExecutable, args, {
      env: { ...process.env, FEDIFY_TEST_MODE: "true" },
    });
    await rejects(readFile(log), { code: "ENOENT" });
    await invoke(nodeExecutable, args, {
      env: { ...process.env, FEDIFY_TEST_MODE: "" },
    });
    deepStrictEqual((await readFile(log, "utf8")).trim().split("\n").sort(), [
      "bun",
      "deno",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const posixTest = process.platform === "win32" ? test.skip : test;

for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
  for (const stage of ["server startup", "blocking lookup"] as const) {
    const blockingLookup = stage === "blocking lookup";
    posixTest(
      `OS ${signal} during ${stage} stops the matrix after cleanup`,
      async () => {
        const dir = await mkdtemp(join(tmpdir(), "fedify matrix signal "));
        const cleaned = join(dir, "cleaned.txt");
        const completed = join(dir, "completed.txt");
        const nextStarted = join(dir, "next-started.txt");
        const fixture = join(dir, "runner.mts");
        const lookupPidFile = join(dir, "lookup.pid");
        const lookupCli = join(dir, "lookup.mjs");
        const serverModule = new URL("./test/server.ts", import.meta.url).href;
        const portModule = new URL("./test/port.ts", import.meta.url).href;
        const runModule = new URL("./test/run.ts", import.meta.url).href;
        const lookupModule = new URL("./test/lookup.ts", import.meta.url).href;
        const mainModule = new URL("./test/mod.ts", import.meta.url).href;
        const apps = ["hono", "express"].map((framework) =>
          join(dir, framework, "npm", "in-memory", "in-process")
        );
        for (const [index, app] of apps.entries()) {
          await mkdir(join(app, "src"), { recursive: true });
          await writeFile(
            join(app, "src", "index.ts"),
            "// Fixture source entry\n",
          );
          const script = join(app, "server.cjs");
          await writeFile(
            script,
            `
const fs = require('node:fs');
fs.writeFileSync(${
              JSON.stringify(join(app, "server.pid"))
            }, String(process.pid));
${
              index === 1
                ? `fs.writeFileSync(${JSON.stringify(nextStarted)}, 'started');`
                : ""
            }
const server = require('node:http').createServer((request, response) => {
  response.writeHead(${blockingLookup ? 200 : 404}); response.end('ready');
});
server.listen(Number(process.env.PORT), () => console.log('port ' + process.env.PORT));
process.on('SIGTERM', () => setTimeout(() => {
  fs.writeFileSync(${JSON.stringify(cleaned)}, 'cleaned');
  server.close(() => process.exit(0));
}, 100));
`,
          );
          await writeFile(
            join(app, "package.json"),
            JSON.stringify({
              scripts: { dev: `node ${JSON.stringify(script)}` },
            }),
          );
        }
        await writeFile(
          lookupCli,
          `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(lookupPidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
        );
        await writeFile(
          fixture,
          `
import { writeFile } from 'node:fs/promises';
import { main } from ${JSON.stringify(mainModule)};
import runTests from ${JSON.stringify(runModule)};
import lookup, { sendLookup } from ${JSON.stringify(lookupModule)};
import { serverClosure } from ${JSON.stringify(serverModule)};
import { reservePort } from ${JSON.stringify(portModule)};
import { join } from 'node:path';
const testLookup = async (dir) => {
  const { port, release } = await reservePort();
  return serverClosure(dir, ['node', join(dir, 'server.cjs')], port,
    (port, signal) => sendLookup(port, ${
            JSON.stringify(lookupCli)
          }, signal), release);
};
const apps = ${JSON.stringify(apps)};
await main(() => runTests(false, {
  create: (testCase) => Promise.resolve(apps[testCase[0] === 'hono' ? 0 : 1]),
  lookup: ${blockingLookup ? "(dirs) => lookup(dirs, testLookup)" : "lookup"},
})(${JSON.stringify({ ...options, webFramework: ["hono", "express"] })}));
await writeFile(${JSON.stringify(completed)}, String(process.exitCode));
`,
        );
        const child = spawn(nodeExecutable, [
          "--experimental-transform-types",
          fixture,
          "test-init",
        ], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout!.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr!.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        const result = new Promise<
          { code: number | null; signal: string | null }
        >(
          (resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code, signal) => resolve({ code, signal }));
          },
        );
        void result.catch(() => {});
        let lookupPid: number | undefined;
        let exitTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const deadline = Date.now() + 15000;
          while (true) {
            if (blockingLookup) {
              try {
                lookupPid = Number(await readFile(lookupPidFile, "utf8"));
                if (lookupPid > 0) break;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                  throw error;
                }
              }
            } else if (stdout.includes("Waiting for server to start")) break;
            if (Date.now() >= deadline || child.exitCode != null) {
              throw new Error(
                `Signal fixture did not start: ${stdout}\n${stderr}`,
              );
            }
            await delay(20);
          }
          equal(child.kill(signal), true);
          const exit = await Promise.race([
            result,
            new Promise<never>((_, reject) => {
              exitTimer = setTimeout(() =>
                reject(
                  new Error(
                    `Runner did not exit promptly after ${signal}: ${stdout}\n${stderr}`,
                  ),
                ), 5000);
            }),
          ]);
          equal(exit.code, exitCode, `${stdout}\n${stderr}`);
          equal(exit.signal, null);
          equal(await readFile(cleaned, "utf8"), "cleaned");
          equal(await readFile(completed, "utf8"), String(exitCode));
          await rejects(readFile(nextStarted), { code: "ENOENT" });
          if (lookupPid != null) {
            let alive = true;
            try {
              process.kill(lookupPid, 0);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
                throw error;
              }
              alive = false;
            }
            equal(alive, false, "The blocking lookup CLI must have exited");
          }
        } finally {
          clearTimeout(exitTimer);
          // On regression, the lookup child can keep the runner's pipes open.
          // Stop only fixture-owned PIDs before awaiting the runner's close.
          for (
            const pidFile of [
              lookupPidFile,
              ...apps.map((app) => join(app, "server.pid")),
            ]
          ) {
            await stopFixtureProcess(pidFile);
          }
          if (child.exitCode == null) child.kill("SIGKILL");
          await result;
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  }
}

async function stopFixtureProcess(pidFile: string): Promise<void> {
  try {
    const pid = Number(await readFile(pidFile, "utf8"));
    if (Number.isSafeInteger(pid) && pid > 0) process.kill(pid, "SIGKILL");
  } catch (error) {
    if (
      !["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")
    ) {
      throw error;
    }
  }
}
