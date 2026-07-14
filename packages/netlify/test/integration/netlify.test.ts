import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import process from "node:process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const rootEnv = fileURLToPath(new URL("../../../../.env", import.meta.url));
const repository = dirname(rootEnv);
const fixture = fileURLToPath(
  new URL("../../fixtures/netlify-dev/", import.meta.url),
);
const functions = fileURLToPath(
  new URL("../../fixtures/netlify-dev/netlify/functions/", import.meta.url),
);
const netlifyState = fileURLToPath(
  new URL("../../fixtures/netlify-dev/.netlify/state.json", import.meta.url),
);
const netlifyDirectory = dirname(netlifyState);
const isNode = !("Deno" in globalThis) &&
  (process.versions as Record<string, string | undefined>).bun == null;

if (isNode) {
  try {
    process.loadEnvFile(rootEnv);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const requiredVariables = ["NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID"] as const;
const missingVariables = requiredVariables.filter((name) => !process.env[name]);
const skipReason = !isNode
  ? "Netlify Dev integration tests run on Node.js only."
  : missingVariables.length > 0
  ? `Missing ${missingVariables.join(", ")}.`
  : false;

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Failed to reserve a TCP port.");
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error == null ? resolve() : reject(error))
  );
  return address.port;
}

async function linkFixtureToSite(siteId: string): Promise<void> {
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(await readFile(netlifyState, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(netlifyState), { recursive: true });
  await writeFile(
    netlifyState,
    `${JSON.stringify({ ...state, siteId }, null, 2)}\n`,
  );
}

async function waitForServer(
  baseUrl: URL,
  child: ChildProcess,
  logs: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  const healthUrl = new URL("/.netlify/functions/status?id=health", baseUrl);
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(
        `Netlify Dev exited with code ${child.exitCode}.\n${logs()}`,
      );
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Netlify Dev did not start in time.\n${logs()}`);
}

async function waitForStatus(
  baseUrl: URL,
  id: string,
  predicate: (status: Status) => boolean,
  logs: () => string,
): Promise<Status> {
  const deadline = Date.now() + 60_000;
  const url = new URL("/.netlify/functions/status", baseUrl);
  url.searchParams.set("id", id);
  let lastStatus: Status | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(url);
    if (response.ok) {
      lastStatus = await response.json() as Status;
      if (predicate(lastStatus)) return lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for ${id}; last status: ${
      JSON.stringify(lastStatus)
    }\n` +
      logs(),
  );
}

interface Status {
  readonly attempts: number;
  readonly overlapped?: boolean;
  readonly completed?: {
    readonly value: string;
    readonly eventId: string;
    readonly position?: number;
  };
}

const integrationTest = skipReason === false ? test : test.skip;

integrationTest(
  "Netlify Dev delivers, retries, and orders Fedify queue tasks",
  {
    timeout: 120_000,
  },
  async (t) => {
    await rm(netlifyDirectory, { force: true, recursive: true });
    await linkFixtureToSite(process.env.NETLIFY_SITE_ID!);
    const require = createRequire(import.meta.url);
    const netlifyBin = require.resolve("netlify-cli/bin/run.js");
    const port = await reservePort();
    const baseUrl = new URL(`http://127.0.0.1:${port}/`);
    let output = "";
    const child = spawn(process.execPath, [
      netlifyBin,
      "dev",
      "--cwd",
      fixture,
      "--auth",
      process.env.NETLIFY_AUTH_TOKEN!,
      "--context",
      "dev",
      "--framework",
      "#static",
      "--functions",
      functions,
      "--no-open",
      "--port",
      port.toString(),
      "--skip-gitignore",
    ], {
      cwd: repository,
      env: {
        ...process.env,
        AWL_API_KEY: crypto.randomUUID(),
        NETLIFY_SITE_ID: process.env.NETLIFY_SITE_ID,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    t.after(async () => {
      if (child.exitCode == null) child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
      if (child.exitCode == null) child.kill("SIGKILL");
      await rm(netlifyDirectory, { force: true, recursive: true });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await rm(netlifyDirectory, { force: true, recursive: true });
    });

    await waitForServer(baseUrl, child, () => output);

    await t.test("delivers a task through the workload function", async () => {
      const id = crypto.randomUUID();
      const response = await fetch(
        new URL("/.netlify/functions/enqueue", baseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, value: "delivered" }),
        },
      );
      equal(response.status, 202, `${await response.text()}\n${output}`);

      const status = await waitForStatus(
        baseUrl,
        id,
        (value) => value.completed != null,
        () => output,
      );
      equal(status.attempts, 1);
      deepStrictEqual(status.completed?.value, "delivered");
      match(status.completed?.eventId ?? "", /^[0-9a-f-]{36}$/i);
    });

    await t.test("lets Async Workloads retry a transient failure", async () => {
      const id = crypto.randomUUID();
      const response = await fetch(
        new URL("/.netlify/functions/enqueue", baseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, value: "retried", failures: 1 }),
        },
      );
      equal(response.status, 202, `${await response.text()}\n${output}`);

      const status = await waitForStatus(
        baseUrl,
        id,
        (value) => value.completed != null,
        () => output,
      );
      equal(status.attempts, 2);
      equal(status.completed?.value, "retried");
      ok(status.completed?.eventId);
    });

    await t.test("serializes tasks with the same ordering key", async () => {
      const ids = [crypto.randomUUID(), crypto.randomUUID()];
      const orderingKey = crypto.randomUUID();
      const responses = [];
      for (const id of ids) {
        responses.push(
          await fetch(new URL("/.netlify/functions/enqueue", baseUrl), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              value: id,
              hold: 1_000,
              orderingKey,
            }),
          }),
        );
      }
      for (const response of responses) {
        equal(response.status, 202, `${await response.text()}\n${output}`);
      }

      const statuses = await Promise.all(ids.map((id) =>
        waitForStatus(
          baseUrl,
          id,
          (value) => value.completed != null,
          () => output,
        )
      ));
      for (const [index, status] of statuses.entries()) {
        equal(status.attempts, 1);
        equal(status.overlapped, undefined);
        equal(status.completed?.position, index + 1);
      }
    });

    await t.test("continues after an ordered event is dead-lettered", async () => {
      const failedId = crypto.randomUUID();
      const nextId = crypto.randomUUID();
      const orderingKey = crypto.randomUUID();
      for (const [id, failures] of [[failedId, 100], [nextId, 0]] as const) {
        const response = await fetch(
          new URL("/.netlify/functions/enqueue", baseUrl),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, value: id, failures, orderingKey }),
          },
        );
        equal(response.status, 202, `${await response.text()}\n${output}`);
      }

      const failed = await waitForStatus(
        baseUrl,
        failedId,
        (value) => value.attempts >= 4,
        () => output,
      );
      const next = await waitForStatus(
        baseUrl,
        nextId,
        (value) => value.completed != null,
        () => output,
      );
      equal(failed.completed, undefined);
      equal(next.attempts, 1);
      equal(next.completed?.position, 1);
    });
  },
);
