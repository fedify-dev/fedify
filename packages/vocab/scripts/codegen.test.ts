import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { setTimeout } from "node:timers/promises";
import {
  acquireLock,
  codegen,
  formatGenerated,
  getLatestMtimeUnder,
  isUpToDate,
} from "./codegen_lib.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fedify-codegen-"));
  const packageDir = join(root, "vocab");
  const src = join(packageDir, "src");
  const tools = join(root, "vocab-tools");
  await mkdir(src, { recursive: true });
  await mkdir(join(packageDir, "scripts"));
  await mkdir(join(tools, "src"), { recursive: true });
  const inputs = [
    join(src, "object.yaml"),
    join(src, "extension.YmL"),
    join(tools, "src", "generate.ts"),
    join(tools, "src", "schema.yaml"),
    join(packageDir, "scripts", "codegen_lib.ts"),
    join(tools, "deno.json"),
    join(packageDir, "package.json"),
  ];
  const old = new Date(Date.now() - 60_000);
  for (const file of inputs) {
    await writeFile(file, "input");
    await utimes(file, old, old);
  }
  return {
    root,
    packageDir,
    src,
    inputs,
    output: join(src, "vocab.ts"),
    lock: join(packageDir, ".vocab-codegen.lock"),
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("regenerates for every schema, generator, helper and metadata input", async () => {
  const f = await fixture();
  let generations = 0;
  const options = {
    packageDir: f.packageDir,
    async generate(_schema: string, destination: string) {
      generations++;
      await writeFile(
        destination,
        `export const generation = ${generations};\n`,
      );
    },
    format: (source: string) => source,
  };
  try {
    await codegen(options);
    equal(generations, 1);
    const mtime = (await stat(f.output)).mtimeMs;
    await codegen(options);
    equal(generations, 1);
    equal((await stat(f.output)).mtimeMs, mtime);
    for (const input of f.inputs) {
      const original = new Date(Date.now() - 60_000);
      for (const other of f.inputs) await utimes(other, original, original);
      // Put the output in the past rather than depending on clock precision.
      const old = new Date(Date.now() - 30_000);
      await utimes(f.output, old, old);
      const changed = new Date(Date.now() - 10_000);
      await utimes(input, changed, changed);
      const before: number = generations;
      await codegen(options);
      equal(generations, before + 1, input);
    }
    await rm(f.output);
    await codegen(options);
    equal(await isUpToDate(f.src, f.output, 0), true);
    equal(await getLatestMtimeUnder(join(f.root, "missing"), [".ts"]), 0);
    await rejects(stat(f.lock), { code: "ENOENT" });
  } finally {
    await f.cleanup();
  }
});

it("formats before publishing and preserves the old output on failure", async () => {
  const f = await fixture();
  try {
    for (const stage of ["generate", "format"]) {
      await writeFile(f.output, "old output");
      const old = new Date(Date.now() - 120_000);
      await utimes(f.output, old, old);
      await rejects(
        codegen({
          packageDir: f.packageDir,
          async generate(_schema, destination) {
            await writeFile(destination, "partial output");
            if (stage === "generate") throw new Error("generation failed");
          },
          format() {
            throw new Error("formatting failed");
          },
        }),
        /failed/,
      );
      equal(await readFile(f.output, "utf8"), "old output");
      deepStrictEqual((await readdir(f.src)).sort(), [
        "extension.YmL",
        "object.yaml",
        "vocab.ts",
      ]);
      await rejects(stat(f.lock), { code: "ENOENT" });
    }
    await codegen({
      packageDir: f.packageDir,
      async generate(_schema, destination) {
        await writeFile(destination, "const value=1");
      },
      format: formatGenerated,
    });
    const output = await readFile(f.output, "utf8");
    equal(output, "const value = 1;\n");
    equal(await formatGenerated(output), output);
  } finally {
    await f.cleanup();
  }
});

it("concurrent generation rechecks freshness inside the lock", async () => {
  const f = await fixture();
  let generations = 0;
  try {
    const options = {
      packageDir: f.packageDir,
      lockOptions: { retryMs: 5 },
      async generate(_schema: string, destination: string) {
        generations++;
        await setTimeout(20);
        await writeFile(destination, "complete output");
      },
      format: (source: string) => source,
    };
    await Promise.all([codegen(options), codegen(options), codegen(options)]);
    equal(generations, 1);
    equal(await readFile(f.output, "utf8"), "complete output");
    await rejects(stat(f.lock), { code: "ENOENT" });
  } finally {
    await f.cleanup();
  }
});

it("waits for held and initializing locks, and bounds the wait", async () => {
  const f = await fixture();
  try {
    const held = await acquireLock(f.lock);
    try {
      await rejects(
        acquireLock(f.lock, { retryMs: 5, timeoutMs: 20 }),
        /Timeout waiting for lock/,
      );
      await stat(join(f.lock, "info"));
    } finally {
      await held.release();
    }
    await mkdir(f.lock); // The creator hasn't written info yet.
    await rejects(
      acquireLock(f.lock, {
        retryMs: 5,
        timeoutMs: 20,
        initializationMs: 10_000,
      }),
      /Timeout waiting for lock/,
    );
    await stat(f.lock);
  } finally {
    await f.cleanup();
  }
});

it("recovers abandoned complete and incomplete locks", async () => {
  const f = await fixture();
  try {
    for (const withInfo of [false, true]) {
      await mkdir(f.lock);
      const path = withInfo ? join(f.lock, "info") : f.lock;
      if (withInfo) await writeFile(path, "abandoned");
      const old = new Date(Date.now() - 600_000);
      await utimes(path, old, old);
      const lock = await acquireLock(f.lock, { retryMs: 5, timeoutMs: 50 });
      await stat(join(f.lock, "info"));
      await lock.release();
      await rejects(stat(f.lock), { code: "ENOENT" });
    }
  } finally {
    await f.cleanup();
  }
});

it("stabilizes long generated expressions with Deno's formatting", async () => {
  const source = `class Sample {
  method() {
    let _27fgyFbosTtMAhuepJH8K3ZGURT6__array = values["http://www.ontology-of-units-of-measure.org/resource/om-2/hasUnit"];
  }
}`;
  const formatted = await formatGenerated(source);
  equal(await formatGenerated(formatted), formatted);
  equal(
    formatted,
    `class Sample {
  method() {
    let _27fgyFbosTtMAhuepJH8K3ZGURT6__array = values[
      "http://www.ontology-of-units-of-measure.org/resource/om-2/hasUnit"
    ];
  }
}
`,
  );
});
