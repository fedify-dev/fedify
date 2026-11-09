import { equal, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import astroDescription from "./webframeworks/astro.ts";
import webFrameworks from "./webframeworks/mod.ts";
import nextDescription from "./webframeworks/next.ts";
import nitroDescription from "./webframeworks/nitro.ts";
import solidstartDescription from "./webframeworks/solidstart.ts";

test("Nitro template loads LogTape during server startup", async () => {
  const { files } = await nitroDescription.init({
    projectName: "test-app",
    dir: ".",
    command: "init",
    packageManager: "npm",
    kvStore: "in-memory",
    messageQueue: "in-process",
    webFramework: "nitro",
    testMode: false,
    dryRun: true,
    allowNonEmpty: false,
    skipInstall: false,
  });

  ok(files);
  ok("server/plugins/logging.ts" in files);
  const plugin = files["server/plugins/logging.ts"];
  ok(plugin);
  ok(plugin.includes('import "../logging";'));
});

test("Next.js template loads LogTape through instrumentation", async () => {
  const { files } = await nextDescription.init({
    projectName: "test-app",
    dir: ".",
    command: "init",
    packageManager: "npm",
    kvStore: "in-memory",
    messageQueue: "in-process",
    webFramework: "next",
    testMode: false,
    dryRun: true,
    allowNonEmpty: false,
    skipInstall: false,
  });

  ok(files);
  ok("instrumentation.ts" in files);
  const instrumentation = files["instrumentation.ts"];
  ok(instrumentation);
  ok(instrumentation.includes("export async function register()"));
  ok(instrumentation.includes("process.env.NEXT_RUNTIME"));
  ok(instrumentation.includes('await import("./logging")'));
});

test("Astro template loads LogTape through middleware", async () => {
  const { files } = await astroDescription.init({
    projectName: "test-app",
    dir: ".",
    command: "init",
    packageManager: "npm",
    kvStore: "in-memory",
    messageQueue: "in-process",
    webFramework: "astro",
    testMode: false,
    dryRun: true,
    allowNonEmpty: false,
    skipInstall: false,
  });

  ok(files);
  const middleware = files["src/middleware.ts"];
  ok(middleware);
  ok(middleware.includes('import "./logging.ts";'));
});

test("SolidStart template loads LogTape through middleware", async () => {
  const { files } = await solidstartDescription.init({
    projectName: "test-app",
    dir: ".",
    command: "init",
    packageManager: "npm",
    kvStore: "in-memory",
    messageQueue: "in-process",
    webFramework: "solidstart",
    testMode: false,
    dryRun: true,
    allowNonEmpty: false,
    skipInstall: false,
  });

  ok(files);
  const middleware = files["src/middleware/index.ts"];
  ok(middleware);
  ok(middleware.includes('import "../logging";'));
});

test("Node.js and Bun templates use Oxfmt and Oxlint", async () => {
  for (const [webFramework, description] of Object.entries(webFrameworks)) {
    if (webFramework === "astro") continue;
    for (const packageManager of ["npm", "bun"] as const) {
      if (!description.packageManagers.includes(packageManager)) continue;
      const initializer = await description.init({
        projectName: "test-app",
        dir: ".",
        command: "init",
        packageManager,
        kvStore: "in-memory",
        messageQueue: "in-process",
        webFramework: webFramework as keyof typeof webFrameworks,
        testMode: false,
        dryRun: true,
        allowNonEmpty: false,
        skipInstall: false,
      });

      equal(initializer.tasks?.format, "oxfmt");
      equal(initializer.tasks?.["format:check"], "oxfmt --check");
      equal(initializer.tasks?.lint, "oxlint .");
      equal(initializer.files?.["eslint.config.ts"], undefined);
      equal(initializer.files?.["eslint.config.mjs"], undefined);
      equal(initializer.devDependencies?.["@fedify/lint"] != null, true);
      equal(initializer.devDependencies?.["oxfmt"] != null, true);
      equal(initializer.devDependencies?.["oxlint"] != null, true);
      equal(initializer.devDependencies?.["eslint"], undefined);
      equal(initializer.devDependencies?.["@biomejs/biome"], undefined);
    }
  }
});

test("Astro Node.js and Bun templates use Prettier for Astro files", async () => {
  for (const packageManager of ["npm", "bun"] as const) {
    const initializer = await astroDescription.init({
      projectName: "test-app",
      dir: ".",
      command: "init",
      packageManager,
      kvStore: "in-memory",
      messageQueue: "in-process",
      webFramework: "astro",
      testMode: false,
      dryRun: true,
      allowNonEmpty: false,
      skipInstall: false,
    });

    equal(
      initializer.tasks?.format,
      "prettier --plugin prettier-plugin-astro --write .",
    );
    equal(
      initializer.tasks?.["format:check"],
      "prettier --plugin prettier-plugin-astro --check .",
    );
    equal(initializer.tasks?.lint, "oxlint .");
    equal(initializer.devDependencies?.["prettier"] != null, true);
    equal(initializer.devDependencies?.["prettier-plugin-astro"] != null, true);
    equal(initializer.devDependencies?.["oxfmt"], undefined);
    equal(initializer.devDependencies?.["oxlint"] != null, true);
    equal(initializer.format?.tool, "prettier");
  }
});

test("README.md's web framework list matches the framework registry", async () => {
  const modSet = new Set(Object.values(webFrameworks).map((f) => f.label));
  const readmeFile = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "README.md",
  );
  const readme = await readFile(readmeFile, "utf-8");
  const readmeWebframeworks = readme.match(
    /\*\*Web frameworks\*\*:\s*([\s\S]+?)(?=\n\s*-\s*\*\*)/,
  );
  ok(readmeWebframeworks);
  const readmeSet = new Set(
    readmeWebframeworks[1]
      .split(/,\s*/)
      .map((s) => s.trim().replace(/^\[|\]$/g, "")),
  );
  const missingInReadme = modSet.difference(readmeSet);
  const missingInMod = readmeSet.difference(modSet);
  const errorMsg = [];
  if (missingInReadme.size > 0) {
    errorMsg.push(`Missing from README.md: ${[...missingInReadme].join(", ")}`);
  }
  if (missingInMod.size > 0) {
    errorMsg.push(
      `Missing from the framework registry: ${[...missingInMod].join(", ")}`,
    );
  }
  if (errorMsg.length > 0) {
    throw new Error(errorMsg.join("\n"));
  }
});
