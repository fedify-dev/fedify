import { test } from "@fedify/fixture";
import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Keep Deno's dependency cache separate from each child's isolated CLI cache.
const denoDir = "Deno" in globalThis
  ? JSON.parse(
    new TextDecoder().decode(
      (await new Deno.Command(Deno.execPath(), {
        args: ["info", "--json"],
        stdout: "piped",
        stderr: "piped",
      }).output()).stdout,
    ),
  ).denoDir as string
  : undefined;

const packageDir = fileURLToPath(new URL("../", import.meta.url));

async function runLookup(args: string[]) {
  // These diagnostic fixtures serve contexts and collection pages on localhost.
  args = ["--allow-private-address", ...args];
  const cache = await mkdtemp(join(tmpdir(), "fedify-lookup-"));
  try {
    const env: Record<string, string | undefined> = {
      ...process.env,
      NO_COLOR: "1",
      XDG_CACHE_HOME: cache,
      LOCALAPPDATA: cache,
    };
    if (denoDir != null) env.DENO_DIR = denoDir;
    delete env.FEDIFY_LOG_FILE;
    for (
      const name of [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
      ]
    ) delete env[name];
    const deno = "Deno" in globalThis;
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      // The existing top-level relay command imports node:sqlite, which Bun
      // does not support. Exercise the built lookup parser and runner directly
      // there; Deno and Node use the complete CLI entry point.
      const bunArgs = [
        "--eval",
        `import { runWithConfig } from "@optique/config/run";
         import { configContext } from "./dist/config.js";
         import { lookupCommand, runLookup } from "./dist/lookup.js";
         const result = await runWithConfig(lookupCommand, configContext, {
           load: () => ({}),
           args: ["lookup", ...process.argv.slice(1)],
           onError: () => process.exit(1),
         });
         await runLookup(result);`,
        "--",
        ...args,
      ];
      const child = spawn(deno ? Deno.execPath() : process.execPath, [
        ...("Bun" in globalThis ? bunArgs : [
          ...(deno ? ["run", "-A", "src/mod.ts"] : ["dist/mod.js"]),
          "--ignore-config",
          "lookup",
          ...args,
        ]),
      ], {
        cwd: packageDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
        killSignal: "SIGKILL",
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (s: string) => stdout += s);
      child.stderr.setEncoding("utf8").on("data", (s: string) => stderr += s);
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    return result;
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

async function withServer(
  fn: (origin: string, requests: string[]) => Promise<void>,
) {
  const requests: string[] = [];
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const server = createServer(async (req, res) => {
    const address = server.address();
    ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const url = new URL(req.url!, origin);
    const path = url.pathname;
    requests.push(path);
    if (path === "/body-timeout") {
      res.setHeader("Content-Type", "application/activity+json");
      res.write('{"@context":');
    }
    if (path.startsWith("/slow") || path === "/body-timeout") {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          resolve();
        }, 1500);
        timers.set(timer, resolve);
        res.once("close", () => {
          clearTimeout(timer);
          timers.delete(timer);
          resolve();
        });
      });
      if (res.destroyed) return;
    }
    if (path === "/body-timeout") {
      res.end('"https://www.w3.org/ns/activitystreams", "type":"Note"}');
      return;
    }
    res.setHeader("Content-Type", "application/activity+json");
    const status = Number(path.slice(1));
    if (status >= 400) {
      res.writeHead(status).end();
      return;
    }
    if (path === "/html") {
      res.setHeader("Content-Type", "text/html");
      res.end("<html>Not an ActivityPub object</html>");
      return;
    }
    if (path === "/dns-text") {
      res.end("dns error");
      return;
    }
    if (path === "/malformed" || path === "/control") {
      res.end(path === "/malformed" ? "{" : "\x1b]0;fedify-test\x07\x1b[8m");
      return;
    }
    const document = path.startsWith("/collection")
      ? {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Collection",
        id: url.href,
        ...(path === "/collection-render"
          ? { items: [{ type: "Note", icon: `${origin}/404` }] }
          : {
            first: `${origin}/${
              path === "/collection403"
                ? "403"
                : path === "/collection-context"
                ? "page-context"
                : path === "/collection-timeout"
                ? "slow"
                : "500"
            }`,
          }),
      }
      : {
        "@context": path === "/context-failure" || path === "/page-context"
          ? `${origin}/404`
          : path === "/context-timeout"
          ? `${origin}/slow-context`
          : "https://www.w3.org/ns/activitystreams",
        type: path === "/page-context" ? "CollectionPage" : "Note",
        id: url.href,
        content: "Successful lookup",
      };
    res.end(JSON.stringify(document));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  ok(address && typeof address !== "string");
  try {
    await fn(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    for (const [timer, resolve] of timers) {
      clearTimeout(timer);
      resolve();
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

for (const status of [401, 403, 404, 410, 429, 500]) {
  test(`lookup command diagnoses HTTP ${status}`, () =>
    withServer(async (origin, requests) => {
      const result = await runLookup([`${origin}/${status}`]);
      equal(result.code, 1, result.stderr);
      match(result.stderr, new RegExp(`HTTP ${status}`));
      equal(result.stderr.includes('Error: "'), false);
      equal(
        result.stderr.includes("Try with -a/--authorized-fetch"),
        [401, 403, 404].includes(status),
      );
      deepStrictEqual(requests, [`/${status}`]);
    }));
}

for (
  const path of ["html", "malformed", "context-failure", "control", "dns-text"]
) {
  test(`lookup command diagnoses ${path}`, () =>
    withServer(async (origin) => {
      const result = await runLookup([`${origin}/${path}`]);
      equal(result.code, 1, result.stderr);
      match(result.stderr, /Failed to fetch/);
      equal(result.stderr.includes("--authorized-fetch"), false);
      if (path === "control") equal(result.stderr.includes("\x1b"), false);
      if (path === "dns-text") {
        equal(result.stderr.includes("Could not resolve the host"), false);
      }
      if (path === "context-failure") match(result.stderr, /HTTP 404/);
    }));
}

test("lookup command retains successes when another lookup throws", () =>
  withServer(async (origin) => {
    const result = await runLookup([
      `${origin}/context-failure`,
      `${origin}/success`,
      `${origin}/500`,
    ]);
    equal(result.code, 1, result.stderr);
    match(result.stdout, /Successful lookup/);
    match(result.stderr, /HTTP 404/);
    match(result.stderr, /HTTP 500/);
    match(result.stderr, /Failed to fetch/);
    equal(result.stderr.includes("--authorized-fetch"), false);
  }));

for (
  const path of [
    "500",
    "collection",
    "collection403",
    "collection-context",
    "collection-render",
  ]
) {
  test(`lookup command diagnoses traversal of ${path}`, () =>
    withServer(async (origin) => {
      const result = await runLookup(["-t", `${origin}/${path}`]);
      equal(result.code, 1, result.stderr);
      match(
        result.stderr,
        new RegExp(
          `HTTP ${
            path === "collection403"
              ? 403
              : path === "collection-context" || path === "collection-render"
              ? 404
              : 500
          }`,
        ),
      );
      equal(
        result.stderr.includes("--authorized-fetch"),
        path === "collection403",
      );
      equal(
        result.stderr.includes("-S/--suppress-errors"),
        path === "collection" || path === "collection-context",
      );
    }));
}

for (
  const path of [
    "slow",
    "body-timeout",
    "context-timeout",
    "collection-timeout",
  ]
) {
  test(`lookup command retains timeout diagnostics for ${path}`, () =>
    withServer(async (origin) => {
      const result = await runLookup([
        ...(path.startsWith("collection") ? ["-t"] : []),
        "-T",
        "0.5",
        `${origin}/${path}`,
      ]);
      equal(result.code, 1, result.stderr);
      match(result.stderr, /Request timed out after 0.5 seconds/);
      match(result.stderr, /-T\/--timeout/);
      equal(result.stderr.includes("--authorized-fetch"), false);
    }));
}

test("lookup command retains batch results when another lookup times out", () =>
  withServer(async (origin) => {
    const result = await runLookup([
      "-T",
      "0.5",
      `${origin}/slow`,
      `${origin}/success`,
    ]);
    equal(result.code, 1, result.stderr);
    match(result.stdout, /Successful lookup/);
    equal(result.stderr.match(/Request timed out after/g)?.length, 1);
    equal(result.stderr.includes("--authorized-fetch"), false);
  }));

test("lookup command reports DNS failures without suggesting authorization", async () => {
  // The reserved .invalid name still uses the system DNS resolver.
  const result = await runLookup(["https://nonexistent.invalid/users/alice"]);
  equal(result.code, 1, result.stderr);
  match(result.stderr, /Failed to fetch/);
  equal(result.stderr.includes("--authorized-fetch"), false);
});

test("lookup command reports connection refusals without suggesting authorization", async () => {
  let origin = "";
  await withServer((url) => {
    origin = url;
    return Promise.resolve();
  });
  const result = await runLookup([`${origin}/object`]);
  equal(result.code, 1, result.stderr);
  match(result.stderr, /Failed to fetch/);
  equal(result.stderr.includes("--authorized-fetch"), false);
});

test("lookup command reports invalid URLs without suggesting authorization", async () => {
  const result = await runLookup(["not-a-url"]);
  equal(result.code, 1, result.stderr);
  match(result.stderr, /Failed to fetch/);
  equal(result.stderr.includes("--authorized-fetch"), false);
});
