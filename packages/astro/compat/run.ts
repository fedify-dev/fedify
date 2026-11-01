import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  commandOutput,
  startCommand,
} from "../../../scripts/tooling_process.ts";

interface CompatibilityCase {
  astro: string;
  adapter: string;
  runtime: "node" | "deno" | "bun";
}

const DEFAULT_CASES: CompatibilityCase[] = [
  { astro: "^5.0.0", adapter: "^9.0.0", runtime: "node" },
  { astro: "^6.0.0", adapter: "^10.0.0", runtime: "node" },
  { astro: "^7.0.0", adapter: "^11.0.0", runtime: "node" },
  { astro: "^7.0.0", adapter: "^0.6.0", runtime: "deno" },
  { astro: "^7.0.0", adapter: "^11.0.0", runtime: "bun" },
];

const compatDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(compatDir, "../../..");

await main();

async function main(): Promise<void> {
  const selected = parseArgs(process.argv.slice(2));
  const cases = selected == null ? DEFAULT_CASES : [selected];
  for (const testCase of cases) await testCompatibility(testCase);
}

function parseArgs(args: string[]): CompatibilityCase | undefined {
  if (args.length === 0) return undefined;
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (value == null || !key.startsWith("--")) {
      throw new TypeError(`Invalid compatibility test argument: ${key}`);
    }
    values.set(key.slice(2), value);
  }
  const astro = values.get("astro");
  const adapter = values.get("adapter");
  const runtime = values.get("runtime") ?? "node";
  if (astro == null || adapter == null) {
    throw new TypeError("Both --astro and --adapter are required.");
  }
  if (runtime !== "node" && runtime !== "deno" && runtime !== "bun") {
    throw new TypeError(`Unsupported runtime: ${runtime}`);
  }
  return { astro, adapter, runtime };
}

async function testCompatibility(testCase: CompatibilityCase): Promise<void> {
  const adapterName = testCase.runtime === "deno"
    ? "@deno/astro-adapter"
    : "@astrojs/node";
  const label =
    `Astro ${testCase.astro}, ${adapterName} ${testCase.adapter}, ${testCase.runtime}`;
  console.log(`Testing ${label}...`);
  const tempDir = await mkdtemp(join(tmpdir(), "fedify-astro-compat-"));
  const port = await reservePort();
  let testFailed = false;
  try {
    const tarballs = await packFedifyPackages(tempDir);
    await writeFile(
      join(tempDir, "astro.config.mjs"),
      await getAstroConfig(testCase, port),
    );
    await cp(join(compatDir, "src"), join(tempDir, "src"), { recursive: true });
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "fedify-astro-compat",
          private: true,
          type: "module",
          dependencies: {
            ...(testCase.runtime === "deno"
              ? { "@deno/astro-adapter": testCase.adapter }
              : { "@astrojs/node": testCase.adapter }),
            "@fedify/astro": tarballs.get("@fedify/astro"),
            "@fedify/fedify": tarballs.get("@fedify/fedify"),
            "@fedify/vocab": tarballs.get("@fedify/vocab"),
            astro: testCase.astro,
          },
          pnpm: {
            overrides: {
              ...Object.fromEntries(tarballs),
              // Version 1.2.0 requires @emnapi/* 2.0 prereleases, while its
              // consumers still provide @emnapi/* 1.x.
              "@napi-rs/wasm-runtime@^1.1.6": "1.1.6",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    await run(["pnpm", "install", "--strict-peer-dependencies"], tempDir);
    await run(getBuildCommand(testCase), tempDir);
    await exerciseServer(tempDir, testCase.runtime, port);
    console.log(`Passed ${label}.`);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    if (process.env.KEEP_ASTRO_COMPAT == null) {
      await removeTempDir(tempDir, testFailed);
    } else {
      console.log(`Kept compatibility fixture at ${tempDir}.`);
    }
  }
}

async function removeTempDir(tempDir: string, testFailed: boolean) {
  try {
    await rm(tempDir, { recursive: true });
  } catch (error) {
    if (!testFailed) throw error;
    console.error(
      `Failed to remove temporary directory ${tempDir}:`,
      error,
    );
  }
}

function getBuildCommand(
  testCase: CompatibilityCase,
): string[] {
  if (testCase.runtime === "deno") {
    return ["deno", "run", "-A", `npm:astro@${testCase.astro}`, "build"];
  }
  if (testCase.runtime === "bun") {
    return ["bunx", "--bun", "astro", "build"];
  }
  return ["pnpm", "exec", "astro", "build"];
}

async function getAstroConfig(
  testCase: CompatibilityCase,
  port: number,
): Promise<string> {
  if (!testCase.astro.startsWith("^7.")) {
    return await readFile(join(compatDir, "astro.config.mjs.tpl"), "utf8");
  }
  const astroDescription = (
    await import("../../init/src/webframeworks/astro.ts")
  ).default;
  const initializer = await astroDescription.init({
    command: "init",
    dir: ".",
    dryRun: true,
    allowNonEmpty: false,
    skipInstall: false,
    kvStore: "in-memory",
    messageQueue: "in-process",
    packageManager: testCase.runtime === "node" ? "npm" : testCase.runtime,
    projectName: "fedify-astro-compat",
    testMode: true,
    webFramework: "astro",
  });
  const config = initializer.files?.["astro.config.ts"];
  if (config == null) throw new Error("Astro initializer produced no config");
  if (testCase.runtime === "deno") {
    const configured = config.replace(
      "adapter: deno(),",
      `adapter: deno({ port: ${port} }),`,
    );
    if (configured === config) {
      throw new Error("Could not configure the Deno compatibility test port");
    }
    return configured;
  }
  return config;
}

async function packFedifyPackages(
  tempDir: string,
): Promise<Map<string, string>> {
  const packages = [
    "astro",
    "fedify",
    "uri-template",
    "vocab",
    "vocab-runtime",
    "vocab-tools",
    "webfinger",
  ];
  const tarballs = new Map<string, string>();
  for (const packageName of packages) {
    const packageDir = join(repoRoot, "packages", packageName);
    const outputDir = join(tempDir, "packages", packageName);
    await mkdir(outputDir, { recursive: true });
    await run(
      [
        "pnpm",
        "pack",
        "--config.ignore-scripts=true",
        "--pack-destination",
        outputDir,
      ],
      packageDir,
    );
    const packageJson = JSON.parse(
      await readFile(join(packageDir, "package.json"), "utf8"),
    );
    for (const entry of await readdir(outputDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".tgz")) {
        tarballs.set(
          packageJson.name,
          `file:./packages/${packageName}/${entry.name}`,
        );
      }
    }
  }
  return tarballs;
}

async function exerciseServer(
  dir: string,
  runtime: "node" | "deno" | "bun",
  port: number,
): Promise<void> {
  const child = startCommand(
    runtime === "node" ? process.execPath : runtime,
    runtime === "deno"
      ? ["run", "-A", "dist/server/entry.mjs"]
      : ["dist/server/entry.mjs"],
    {
      cwd: dir,
      env: { HOST: "127.0.0.1", PORT: String(port) },
    },
  );
  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  try {
    await Promise.race([
      waitUntilReady(`http://127.0.0.1:${port}/users/alice`),
      child.status.then((status) => {
        throw new Error(
          `Server exited before validation (code ${status.code})`,
        );
      }),
    ]);
    const html = await fetch(`http://127.0.0.1:${port}/users/alice`, {
      headers: { Accept: "text/html" },
    });
    assertEquals(html.status, 200, "shared HTML route status");
    assertIncludes(
      await html.text(),
      "Astro profile for alice",
      "shared HTML route body",
    );
    assertEquals(
      html.headers.get("X-Additional-Middleware"),
      "called",
      "composed middleware header",
    );

    const actor = await fetch(`http://127.0.0.1:${port}/users/alice`, {
      headers: { Accept: "application/activity+json" },
    });
    assertEquals(actor.status, 200, "ActivityPub route status");
    const actorJson = await actor.json() as {
      id?: string;
      preferredUsername?: string;
    };
    assertEquals(actorJson.preferredUsername, "alice", "ActivityPub actor");
    if (actorJson.id == null) throw new Error("ActivityPub actor has no id");
    const actorHost = new URL(actorJson.id).host;

    const webFinger = await fetch(
      `http://127.0.0.1:${port}/.well-known/webfinger?resource=${
        encodeURIComponent(`acct:alice@${actorHost}`)
      }`,
    );
    assertEquals(webFinger.status, 200, "WebFinger status");
    const jrd = await webFinger.json() as { subject?: string };
    assertEquals(
      jrd.subject,
      `acct:alice@${actorHost}`,
      "WebFinger subject",
    );

    const notFound = await fetch(`http://127.0.0.1:${port}/unrelated`);
    try {
      assertEquals(notFound.status, 404, "Astro fallback status");
    } finally {
      await notFound.body?.cancel();
    }

    const notAcceptable = await fetch(`http://127.0.0.1:${port}/objects/test`, {
      headers: { Accept: "text/html" },
    });
    try {
      assertEquals(
        notAcceptable.status,
        406,
        "unacceptable representation status",
      );
      assertIncludes(
        notAcceptable.headers.get("Vary") ?? "",
        "Accept",
        "Vary header",
      );
    } finally {
      await notAcceptable.body?.cancel();
    }
  } catch (error) {
    await child.stop();
    const [stdout, stderr] = await Promise.all([
      stdoutPromise,
      stderrPromise,
    ]);
    console.error(stdout);
    console.error(stderr);
    throw error;
  } finally {
    await Promise.all([child.stop(), stdoutPromise, stderrPromise]);
  }
}

async function reservePort(): Promise<number> {
  const server = createServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        server.close();
        reject(new Error("Cannot reserve compatibility port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitUntilReady(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function run(command: string[], cwd: string): Promise<void> {
  const output = await commandOutput(command[0], command.slice(1), { cwd });
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `${command.join(" ")} failed:\n${decoder.decode(output.stdout)}${
        decoder.decode(output.stderr)
      }`,
    );
  }
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function assertIncludes(actual: string, expected: string, label: string): void {
  if (!actual.includes(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(actual)} to include ${
        JSON.stringify(expected)
      }`,
    );
  }
}
