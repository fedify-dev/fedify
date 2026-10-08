import { dirname, fromFileUrl, join, resolve } from "@std/path";

const compatDir = dirname(fromFileUrl(import.meta.url));
const repoRoot = resolve(compatDir, "../../..");
const cases = [
  { kit: "2.0.0", svelte: "^4.0.0", vite: "^5.0.0", plugin: "^3.0.0" },
  { kit: "2.36.2", svelte: "^5.0.0", vite: "^7.0.0", plugin: "^6.0.0" },
  { kit: "3.0.0", svelte: "^5.57.1", vite: "^8.0.12", plugin: "^7.0.0" },
];

const tempDir = await Deno.makeTempDir({ prefix: "fedify-sveltekit-compat-" });
try {
  const tarballs = await packFedifyPackages(tempDir);
  const consumer = await Deno.readTextFile(join(compatDir, "consumer.ts"));
  for (const testCase of cases) {
    console.log(`Checking SvelteKit ${testCase.kit} consumer types...`);
    const dir = join(tempDir, testCase.kit);
    await Deno.mkdir(dir);
    await Deno.writeTextFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "fedify-sveltekit-type-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@fedify/sveltekit": tarballs.get("@fedify/sveltekit"),
          "@fedify/fedify": tarballs.get("@fedify/fedify"),
          "@sveltejs/kit": testCase.kit,
          "@sveltejs/vite-plugin-svelte": testCase.plugin,
          svelte: testCase.svelte,
          vite: testCase.vite,
          typescript: "^6.0.0",
          "@types/node": "^22.0.0",
        },
        pnpm: { overrides: Object.fromEntries(tarballs) },
      }),
    );
    await Deno.writeTextFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          target: "ESNext",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          types: ["node"],
        },
        files: ["consumer.mts", "consumer.cts"],
      }),
    );
    await Deno.writeTextFile(join(dir, "consumer.mts"), consumer);
    await Deno.writeTextFile(join(dir, "consumer.cts"), consumer);
    // Install packed artifacts rather than workspace links so declarations
    // resolve SvelteKit from this consumer, not the workspace's pinned 2.x.
    await run([
      "pnpm",
      "install",
      "--strict-peer-dependencies",
      "--ignore-scripts",
    ], dir);
    await run(["pnpm", "exec", "tsc", "--project", "tsconfig.json"], dir);
    console.log(`Passed SvelteKit ${testCase.kit} (ESM and CommonJS).`);
  }
} finally {
  await Deno.remove(tempDir, { recursive: true });
}

async function packFedifyPackages(dir: string): Promise<Map<string, string>> {
  const tarballs = new Map<string, string>();
  for (
    const name of [
      "sveltekit",
      "fedify",
      "uri-template",
      "vocab",
      "vocab-runtime",
      "vocab-tools",
      "webfinger",
    ]
  ) {
    const packageDir = join(repoRoot, "packages", name);
    const outputDir = join(dir, "packages", name);
    await Deno.mkdir(outputDir, { recursive: true });
    await run([
      "pnpm",
      "pack",
      "--config.ignore-scripts=true",
      "--pack-destination",
      outputDir,
    ], packageDir);
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.isFile && entry.name.endsWith(".tgz")) {
        tarballs.set(`@fedify/${name}`, `file:${join(outputDir, entry.name)}`);
      }
    }
    if (!tarballs.has(`@fedify/${name}`)) {
      throw new Error(`No tarball produced for @fedify/${name}`);
    }
  }
  return tarballs;
}

async function run(args: string[], cwd: string): Promise<void> {
  const result = await new Deno.Command(args[0], {
    args: args.slice(1),
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    throw new Error(`Command failed (${result.code}): ${args.join(" ")}`);
  }
}
