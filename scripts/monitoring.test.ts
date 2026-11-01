import { equal } from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startCommand } from "./tooling_process.ts";

const posixTest = process.platform === "win32" ? test.skip : test;

posixTest(
  "monitoring SIGTERM waits for compose teardown and retains exit 143",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "fedify monitoring signal "));
    const started = join(dir, "started");
    const cleaned = join(dir, "cleaned");
    await writeFile(
      join(dir, "docker"),
      `#!/usr/bin/env node
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    if (args.includes('up')) {
      fs.writeFileSync(${JSON.stringify(started)}, 'ready');
      setInterval(() => {}, 1000);
    } else if (args.includes('down') && fs.existsSync(${
        JSON.stringify(started)
      })) {
      setTimeout(() => fs.writeFileSync(${
        JSON.stringify(cleaned)
      }, 'done'), 300);
    }
  `,
      { mode: 0o755 },
    );
    const node = process.versions.deno != null || process.versions.bun != null
      ? "node"
      : process.execPath;
    const child = startCommand(node, [
      "--experimental-strip-types",
      fileURLToPath(
        new URL("../examples/monitoring/validate.ts", import.meta.url),
      ),
      "--config-only",
      "--smoke",
    ], { env: { PATH: dir + delimiter + process.env.PATH } });
    const output = Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    try {
      const deadline = Date.now() + 10_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          ready = await readFile(started, "utf8") === "ready";
          if (ready) break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await delay(20);
      }
      equal(ready, true, "compose up started");
      child.child.kill("SIGTERM");
      equal((await child.status).code, 143);
      equal(await readFile(cleaned, "utf8"), "done");
    } finally {
      await child.stop();
      await output;
      await rm(dir, { recursive: true, force: true });
    }
  },
);
