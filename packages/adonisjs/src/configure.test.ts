/**
 * Tests for the `configure` hook, which `node ace configure @fedify/adonisjs`
 * runs.
 *
 * The hook is exercised the way the official AdonisJS packages test theirs: a
 * throwaway application directory, a real `Configure` command from a real
 * Ace kernel, and assertions on the files the codemods leave behind.  Only the
 * package installation is stubbed, because it would spawn a package manager.
 *
 * @module
 */
import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import Configure from "@adonisjs/core/commands/configure";
import { IgnitorFactory } from "@adonisjs/core/factories";

/**
 * The package entry point, which is what the command receives when a user runs
 * `node ace configure @fedify/adonisjs`.
 */
const PACKAGE_ENTRY = new URL("../index.ts", import.meta.url).href;

/**
 * Writes the smallest application skeleton the codemods need: an rc file to
 * add the provider and preload to, a kernel with the two middleware stacks, an
 * env schema, and the dot-env files.
 */
async function scaffoldApp(dir: string): Promise<void> {
  await mkdir(join(dir, "start"), { recursive: true });
  await writeFile(join(dir, ".env"), "");
  await writeFile(join(dir, ".env.example"), "");
  await writeFile(join(dir, "tsconfig.json"), "{}");
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "app",
      type: "module",
      imports: { "#start/*": "./start/*.js" },
    }),
  );
  await writeFile(
    join(dir, "adonisrc.ts"),
    "import { defineConfig } from '@adonisjs/core/app'\n" +
      "export default defineConfig({})\n",
  );
  await writeFile(
    join(dir, "start/kernel.ts"),
    "import router from '@adonisjs/core/services/router'\n" +
      "import server from '@adonisjs/core/services/server'\n" +
      "server.use([() => import('#middleware/force_json_response_middleware')])\n" +
      "router.use([])\n",
  );
  await writeFile(
    join(dir, "start/env.ts"),
    "import { Env } from '@adonisjs/core/env'\n" +
      "export default await Env.create(new URL('../', import.meta.url), {\n" +
      "})\n",
  );
}

describe("the configure hook", () => {
  let dir: string | undefined;

  after(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("wires a fresh application", async () => {
    dir = await mkdtemp(join(tmpdir(), "fedify-adonisjs-configure-"));
    await scaffoldApp(dir);

    const ignitor = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .create(pathToFileURL(`${dir}/`), {
        importer: (filePath) => import(filePath),
      });
    const app = ignitor.createApp("web");
    await app.init();
    await app.boot();

    const ace = await app.container.make("ace");
    ace.ui.switchMode("raw");
    const command = await ace.create(Configure, [PACKAGE_ENTRY]);

    // `installPackages` runs the application's package manager for real; the
    // wiring is what is under test, not npm.  The specifiers it was given are
    // kept for the assertion on the version range below.
    const installed: string[] = [];
    const createCodemods = command.createCodemods.bind(command);
    command.createCodemods = async () => {
      const codemods = await createCodemods();
      codemods.installPackages = (packages) => {
        installed.push(...packages.map(({ name }) => name));
        return Promise.resolve(true);
      };
      return codemods;
    };

    await command.exec();
    strictEqual(
      command.exitCode,
      0,
      `configure failed: ${String(command.error)}`,
    );

    const read = (path: string) => readFile(join(dir!, path), "utf8");

    // The stubs landed where `config/fedify.stub` and friends say they do.
    ok(await read("config/fedify.ts"));
    ok(await read("start/federation.ts"));
    ok(await read("app/federation/main.ts"));

    // The provider and the preload file are registered by the subpaths the
    // package exports.
    const rcFile = await read("adonisrc.ts");
    match(rcFile, /@fedify\/adonisjs\/fedify_provider/);
    match(rcFile, /#start\/federation/);

    // The middleware went into the server stack, not the router stack, and
    // ahead of what was already there: middleware such as the API starter
    // kit's `force_json_response_middleware` rewrites the `Accept` header,
    // and Fedify has to negotiate on the client's real one.
    const kernel = await read("start/kernel.ts");
    match(
      kernel,
      /server\.use\(\[\s*\(\) => import\('@fedify\/adonisjs\/fedify_middleware'\),\s*\(\) => import\('#middleware\/force_json_response_middleware'\)/,
    );
    ok(!/router\.use\(\[[^\]]*fedify/.test(kernel));

    // The environment variable and its validation rule.
    match(await read(".env"), /PUBLIC_URL=http:\/\/localhost:3333/);
    match(await read("start/env.ts"), /PUBLIC_URL: Env\.schema\.string/);
    match(
      await read("start/env.ts"),
      /FEDERATION_HANDLE_HOST: Env\.schema\.string\.optional/,
    );

    // The Fedify runtime packages are installed within the range the
    // `@fedify/fedify` peer dependency accepts, which is this package's own
    // version -- the monorepo bumps every package together and declares the
    // peer dependency as `workspace:^`.  Unpinned, a `node ace add` run after
    // the next major release would install that release instead, break the
    // peer range and risk a second copy of the vocabulary in the tree.
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    deepStrictEqual(installed, [
      `@fedify/fedify@^${version}`,
      `@fedify/vocab@^${version}`,
    ]);
  });
});
