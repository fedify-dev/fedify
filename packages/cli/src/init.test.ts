import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";

const CLI_PATH = join(import.meta.dirname!, "mod.ts");

async function runInit(
  args: string[],
): Promise<{ output: string; success: boolean }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", CLI_PATH, "init", ...args],
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  });

  const process = cmd.spawn();
  const output = await process.output();
  const decoder = new TextDecoder();
  const stdout = decoder.decode(output.stdout);
  const stderr = decoder.decode(output.stderr);

  return {
    output: stdout + stderr,
    success: output.success,
  };
}

Deno.test("init --dry-run shows preview without creating files", async () => {
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-project");

  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "deno",
    ]);

    // Check that dry-run mode is indicated
    assertStringIncludes(result.output, "🔍 DRY RUN MODE");
    assertStringIncludes(result.output, "Would create files:");
    assertStringIncludes(result.output, "Would install dependencies:");

    assertStringIncludes(result.output, "federation.ts");
    assertStringIncludes(result.output, "logging.ts");
    assertStringIncludes(result.output, "main.ts");
    assertStringIncludes(result.output, "deno.json");
    assertStringIncludes(result.output, ".env");

    // Verify no files were actually created
    assertEquals(
      await exists(projectDir),
      false,
      "Project directory should not be created",
    );
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init --dry-run with web framework shows correct files", async () => {
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-hono-project");

  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "deno",
      "--web-framework",
      "hono",
    ]);

    // Check Hono-specific files
    assertStringIncludes(result.output, "src/federation.ts");
    assertStringIncludes(result.output, "src/app.tsx");
    assertStringIncludes(result.output, "src/index.ts");
    assertStringIncludes(result.output, "@hono/hono");

    // Verify no files were created
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init --dry-run with external stores shows dependencies", async () => {
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-redis-project");

  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "deno",
      "--kv-store",
      "redis",
      "--message-queue",
      "redis",
    ]);

    // Check Redis dependencies
    assertStringIncludes(result.output, "@fedify/redis");
    assertStringIncludes(result.output, "ioredis");
    assertStringIncludes(result.output, "REDIS_URL");

    // Check Redis imports in federation.ts
    assertStringIncludes(result.output, "RedisKvStore");
    assertStringIncludes(result.output, "RedisMessageQueue");

    // Verify no files were created
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init --dry-run shows command for framework initialization", async () => {
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-nitro-project");

  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "node",
      "--package-manager",
      "npm",
      "--web-framework",
      "nitro",
    ]);

    // Check that initialization command is shown
    assertStringIncludes(result.output, "Would run command:");
    assertStringIncludes(result.output, "giget@latest nitro");

    // Check Node.js specific files
    assertStringIncludes(result.output, "package.json");
    assertStringIncludes(result.output, "biome.json");

    // Verify no files were created
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init --dry-run fails on non-empty directory", async () => {
  const testDir = await Deno.makeTempDir();

  try {
    // Create a file in the directory
    await Deno.writeTextFile(join(testDir, "existing.txt"), "content");

    const result = await runInit([
      testDir,
      "--dry-run",
      "--runtime",
      "deno",
    ]);

    assertStringIncludes(result.output, "The directory is not empty");
    assertEquals(result.success, false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init --dry-run shows prepend files for Fresh", async () => {
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-fresh-project");

  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "deno",
      "--web-framework",
      "fresh",
    ]);

    // Check that prepend files are shown
    assertStringIncludes(result.output, "Would prepend to files:");
    assertStringIncludes(result.output, "fresh.config.ts");

    // Verify no files were created
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init --dry-run shows dev dependencies for Node.js", async () => {
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-node-project");

  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "node",
      "--package-manager",
      "npm",
    ]);

    // Check dev dependencies
    assertStringIncludes(result.output, "Would install dev dependencies:");
    assertStringIncludes(result.output, "@biomejs/biome");

    // Verify no files were created
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init - check version for AMQP package", async () => {
  const amqpData = await Deno.readTextFile(
    join(import.meta.dirname!, "../../amqp/deno.json"),
  );
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-amqp-project");
  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "deno",
      "--message-queue",
      "amqp",
    ]);

    assertStringIncludes(
      result.output,
      `@fedify/amqp@${JSON.parse(amqpData).version.trim()}`,
    );
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init - check version for Redis package", async () => {
  const redisData = await Deno.readTextFile(
    join(import.meta.dirname!, "../../redis/deno.json"),
  );
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-redis-project");
  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "deno",
      "--kv-store",
      "redis",
    ]);

    assertStringIncludes(
      result.output,
      `@fedify/redis@${JSON.parse(redisData).version.trim()}`,
    );
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});

Deno.test("init - check version for Postgres package", async () => {
  const postgresData = await Deno.readTextFile(
    join(import.meta.dirname!, "../../postgres/deno.json"),
  );
  const testDir = await Deno.makeTempDir();
  const projectDir = join(testDir, "test-postgres-project");
  try {
    const result = await runInit([
      projectDir,
      "--dry-run",
      "--runtime",
      "deno",
      "--kv-store",
      "postgres",
    ]);

    assertStringIncludes(
      result.output,
      `@fedify/postgres@${JSON.parse(postgresData).version.trim()}`,
    );
    assertEquals(await exists(projectDir), false);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
});
