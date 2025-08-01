import { Activity, Note } from "@fedify/fedify";
import { assertEquals, assertExists } from "@std/assert";
import { getContextLoader } from "./docloader.ts";
import { createFileStream, writeObjectToStream } from "./lookup.ts";

Deno.test("createFileStream - creates file stream with proper directory creation", async () => {
  const testDir = "./test_output";
  const testFile = `${testDir}/test.json`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const stream = await createFileStream(testFile);
  assertExists(stream);

  const stat = await Deno.stat(testDir);
  assertEquals(stat.isDirectory, true);

  stream.close();

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("createFileStream - works with absolute paths", async () => {
  const testDir = `${Deno.cwd()}/test_output_absolute`;
  const testFile = `${testDir}/test.json`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const stream = await createFileStream(testFile);
  assertExists(stream);

  const stat = await Deno.stat(testDir);
  assertEquals(stat.isDirectory, true);

  stream.close();

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("createFileStream - creates nested directories", async () => {
  const testDir = "./test_output_nested/deep/path";
  const testFile = `${testDir}/test.json`;

  try {
    await Deno.remove("./test_output_nested", { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const stream = await createFileStream(testFile);
  assertExists(stream);

  // Verify nested directories were created
  const stat = await Deno.stat(testDir);
  assertEquals(stat.isDirectory, true);
  stream.close();

  await Deno.remove("./test_output_nested", { recursive: true });
});

Deno.test("createFileStream - writes data correctly", async () => {
  const testDir = "./test_output_write";
  const testFile = `${testDir}/test.txt`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const stream = await createFileStream(testFile);
  const writer = stream.getWriter();

  const testData = new TextEncoder().encode("Hello, World!");
  await writer.write(testData);
  await writer.close();

  const content = await Deno.readTextFile(testFile);
  assertEquals(content, "Hello, World!");

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("createFileStream - truncates existing file", async () => {
  const testDir = "./test_output_truncate";
  const testFile = `${testDir}/test.txt`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  await Deno.mkdir(testDir, { recursive: true });
  await Deno.writeTextFile(testFile, "Old content");

  const stream = await createFileStream(testFile);
  const writer = stream.getWriter();

  const testData = new TextEncoder().encode("New content");
  await writer.write(testData);
  await writer.close();

  // Verify file was truncated and new content written
  const content = await Deno.readTextFile(testFile);
  assertEquals(content, "New content");

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("writeObjectToStream - writes Note object with default options", {
  sanitizeResources: false,
}, async () => {
  const testDir = "./test_output_note";
  const testFile = `${testDir}/note.txt`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Hello, fediverse!",
  });

  const options = {
    firstKnock: "rfc9421" as const,
    separator: "----",
    output: testFile,
  };

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(note, options, contextLoader);

  const content = await Deno.readTextFile(testFile);
  assertExists(content);
  assertEquals(content.includes("Hello, fediverse!"), true);
  assertEquals(content.includes("Note"), true);

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("writeObjectToStream - writes Activity object in raw JSON-LD format", async () => {
  const testDir = "./test_output_activity";
  const testFile = `${testDir}/activity.json`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const activity = new Activity({
    id: new URL("https://example.com/activities/1"),
  });

  const options = {
    firstKnock: "rfc9421" as const,
    separator: "----",
    output: testFile,
    raw: true,
  };

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(activity, options, contextLoader);

  // Verify file exists and contains JSON-LD
  const content = await Deno.readTextFile(testFile);

  assertExists(content);
  assertEquals(content.includes("@context"), true);
  assertEquals(content.includes("id"), true);

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("writeObjectToStream - writes object in compact JSON-LD format", async () => {
  const testDir = "./test_output_compact";
  const testFile = `${testDir}/compact.json`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Test note",
  });

  const options = {
    firstKnock: "rfc9421" as const,
    separator: "----",
    output: testFile,
    compact: true,
  };

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(note, options, contextLoader);

  // Verify file exists and contains compacted JSON-LD
  const content = await Deno.readTextFile(testFile);
  assertExists(content);
  assertEquals(content.includes("Test note"), true);

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("writeObjectToStream - writes object in expanded JSON-LD format", async () => {
  const testDir = "./test_output_expand";
  const testFile = `${testDir}/expand.json`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Test note for expansion",
  });

  const options = {
    firstKnock: "rfc9421" as const,
    separator: "----",
    output: testFile,
    expand: true,
  };

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(note, options, contextLoader);

  const content = await Deno.readTextFile(testFile);
  assertExists(content);
  assertEquals(content.includes("Test note for expansion"), true);

  await Deno.remove(testDir, { recursive: true });
});

Deno.test("writeObjectToStream - writes to stdout when no output file specified", async () => {
  const note = new Note({
    id: new URL("https://example.com/notes/1"),
    content: "Test stdout note",
  });

  const options = {
    firstKnock: "rfc9421" as const,
    separator: "----",
  };

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(note, options, contextLoader);
});

Deno.test("writeObjectToStream - handles empty content properly", async () => {
  const testDir = "./test_output_empty";
  const testFile = `${testDir}/empty.txt`;

  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }

  const note = new Note({
    id: new URL("https://example.com/notes/1"),
  });

  const options = {
    firstKnock: "rfc9421" as const,
    separator: "----",
    output: testFile,
  };

  const contextLoader = await getContextLoader({});

  await writeObjectToStream(note, options, contextLoader);

  const content = await Deno.readTextFile(testFile);
  assertExists(content);
  assertEquals(content.includes("Note"), true);

  await Deno.remove(testDir, { recursive: true });
});
