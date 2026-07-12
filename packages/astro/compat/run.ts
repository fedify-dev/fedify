import { copy } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

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

const compatDir = dirname(fromFileUrl(import.meta.url));
const repoRoot = resolve(compatDir, "../../..");

await main();

async function main(): Promise<void> {
  const selected = parseArgs(Deno.args);
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
  const tempDir = await Deno.makeTempDir({ prefix: "fedify-astro-compat-" });
  const port = reservePort();
  try {
    const tarballs = await packFedifyPackages(tempDir);
    await Deno.writeTextFile(
      join(tempDir, "astro.config.mjs"),
      await getAstroConfig(testCase, port),
    );
    await copy(join(compatDir, "src"), join(tempDir, "src"));
    await Deno.writeTextFile(
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
          pnpm: { overrides: Object.fromEntries(tarballs) },
        },
        null,
        2,
      ) + "\n",
    );

    await run(["pnpm", "install", "--strict-peer-dependencies"], tempDir);
    await run(["pnpm", "exec", "astro", "build"], tempDir);
    await exerciseServer(tempDir, testCase.runtime, port);
    console.log(`Passed ${label}.`);
  } finally {
    if (Deno.env.get("KEEP_ASTRO_COMPAT") == null) {
      await Deno.remove(tempDir, { recursive: true });
    } else {
      console.log(`Kept compatibility fixture at ${tempDir}.`);
    }
  }
}

async function getAstroConfig(
  testCase: CompatibilityCase,
  port: number,
): Promise<string> {
  if (!testCase.astro.startsWith("^7.")) {
    return await Deno.readTextFile(join(compatDir, "astro.config.mjs.tpl"));
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
    await Deno.mkdir(outputDir, { recursive: true });
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
      await Deno.readTextFile(join(packageDir, "package.json")),
    );
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.isFile && entry.name.endsWith(".tgz")) {
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
  const command = new Deno.Command(runtime, {
    args: runtime === "deno"
      ? ["run", "-A", "dist/server/entry.mjs"]
      : ["dist/server/entry.mjs"],
    cwd: dir,
    env: { HOST: "127.0.0.1", PORT: String(port) },
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();
  const stdoutPromise = new Response(process.stdout).text();
  const stderrPromise = new Response(process.stderr).text();
  try {
    await waitUntilReady(`http://127.0.0.1:${port}/users/alice`);
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
    try {
      process.kill("SIGTERM");
    } catch {
      // The server may have exited before the readiness check failed.
    }
    const [stdout, stderr] = await Promise.all([
      stdoutPromise,
      stderrPromise,
    ]);
    console.error(stdout);
    console.error(stderr);
    throw error;
  } finally {
    try {
      process.kill("SIGTERM");
    } catch {
      // The server may already have exited.
    }
    await Promise.all([process.status, stdoutPromise, stderrPromise]);
  }
}

function reservePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitUntilReady(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function run(command: string[], cwd: string): Promise<void> {
  const output = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
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
