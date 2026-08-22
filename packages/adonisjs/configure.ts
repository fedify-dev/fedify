/**
 * The configure hook, run by `node ace configure @fedify/adonisjs`.
 *
 * It performs every wiring step the package needs, so that a freshly configured
 * application already federates: install the Fedify runtime packages, declare
 * the environment variables, publish the config file and the federation preload
 * files, register the service provider, and add the middleware to the server
 * stack.
 *
 * @module
 */
import type ConfigureCommand from "@adonisjs/core/commands/configure";

import { stubsRoot } from "./stubs/main.ts";

/**
 * The slice of `@adonisjs/assembler`'s `RcFileTransformer` this hook touches.
 *
 * Spelled out rather than inferred because the assembler is an *optional* peer
 * dependency: wherever it is absent — a type-check of a tree that did not
 * install it, for instance — the inferred parameter type of `updateRcFile`'s
 * callback degrades to `any`, and this file stops compiling under
 * `noImplicitAny`.
 */
interface RcFileEditor {
  addProvider(providerPath: string): unknown;
  addPreloadFile(modulePath: string): unknown;
}

export async function configure(command: ConfigureCommand): Promise<void> {
  const codemods = await command.createCodemods();

  /**
   * Fedify itself is a peer dependency: the application, not this package,
   * decides which version it runs, and having exactly one copy in the tree
   * matters because Fedify's vocabulary classes are compared with `instanceof`.
   *
   * `@fedify/vocab` carries the ActivityStreams classes (`Person`, `Follow`,
   * `Note`, …) that dispatchers and inbox listeners are written against.
   */
  await codemods.installPackages([
    { name: "@fedify/fedify", isDevDependency: false },
    { name: "@fedify/vocab", isDevDependency: false },
  ]);

  /**
   * `PUBLIC_URL` is the canonical origin remote servers use to reach this
   * application.  Fedify mints actor URIs and activity IDs from it, so it has to
   * be the public address rather than the listen address — behind a proxy or a
   * `fedify tunnel` those differ.
   *
   * `FEDERATION_HANDLE_HOST` is optional and only needed when fediverse handles
   * live on a different domain than the web origin, for example `@me@example.com`
   * served from `https://social.example.com`.
   */
  await codemods.defineEnvValidations({
    leadingComment: "Variables for configuring Fedify",
    variables: {
      PUBLIC_URL: `Env.schema.string({ format: 'url', tld: false })`,
      FEDERATION_HANDLE_HOST: `Env.schema.string.optional({ format: 'host' })`,
    },
  });

  await codemods.defineEnvVariables({ PUBLIC_URL: "http://localhost:3333" });

  /**
   * `config/fedify.ts` — the federation options.
   */
  await codemods.makeUsingStub(stubsRoot, "config/fedify.stub", {});

  /**
   * `start/federation.ts` — a preload file that imports the application's
   * dispatcher modules.
   *
   * A preload file rather than directory globbing: preload files are ordinary
   * application source, so `node ace build` compiles them and their relative
   * imports along with everything else, and AdonisJS imports them after every
   * provider has booted, which is what lets dispatchers use Lucid models.
   */
  await codemods.makeUsingStub(stubsRoot, "start/federation.stub", {});

  /**
   * `app/federation/main.ts` — a starting point for dispatchers.
   */
  await codemods.makeUsingStub(stubsRoot, "federation/main.stub", {});

  await codemods.updateRcFile((rcFile: RcFileEditor) => {
    rcFile.addProvider("@fedify/adonisjs/provider");
    rcFile.addPreloadFile("#start/federation");
  });

  /**
   * The middleware must live in the **server** stack.
   *
   * Fedify answers paths the AdonisJS router does not know about
   * (`/.well-known/webfinger`, `/.well-known/nodeinfo`, actor and inbox
   * endpoints), so it has to run before route matching.  The server stack also
   * runs before `bodyparser_middleware` and before `@adonisjs/shield`, which
   * matters twice over: HTTP Signature verification needs the raw, unparsed
   * request body, and inbox `POST`s must not be rejected by CSRF protection.
   */
  await codemods.registerMiddleware("server", [{
    path: "@fedify/adonisjs/middleware",
  }]);

  command.logger.success("Configured @fedify/adonisjs");
  command.logger.info(
    'Register dispatchers in app/federation/main.ts, then run "node ace serve"',
  );
}
