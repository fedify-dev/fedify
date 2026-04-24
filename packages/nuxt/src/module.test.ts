import { test } from "@fedify/fixture";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { isAbsolute } from "node:path";
import {
  buildContextFactoryResolver,
  resolveModulePath,
  resolveRuntimeServerPath,
} from "./module.ts";

test(
  "relative module path must resolve to absolute path",
  () => {
    const aliases = { "~": "/app", "@": "/app" };
    const rootDir = "/app";

    // Aliased path works correctly
    const aliased = resolveModulePath("~/server/federation", aliases, rootDir);
    ok(
      isAbsolute(aliased),
      `aliased path should be absolute, got: ${aliased}`,
    );

    // Plain relative path must now also resolve to absolute
    const relative = resolveModulePath(
      "./server/federation",
      aliases,
      rootDir,
    );
    ok(
      isAbsolute(relative),
      `relative path should be resolved to absolute, got: ${relative}`,
    );
    equal(relative, "/app/server/federation");
  },
);

test(
  "bare specifier must be preserved for bundler resolution",
  () => {
    const aliases = { "~": "/app", "@": "/app" };
    const rootDir = "/app";

    equal(
      resolveModulePath("@acme/federation", aliases, rootDir),
      "@acme/federation",
    );
    equal(
      resolveModulePath("my-federation-pkg", aliases, rootDir),
      "my-federation-pkg",
    );
  },
);

test(
  "runtime server files must resolve to compiled JavaScript output",
  () => {
    const requestedPaths: string[] = [];
    const resolver = {
      resolve(path: string): string {
        requestedPaths.push(path);
        return `/package/${path}`;
      },
    };

    equal(
      resolveRuntimeServerPath(resolver, "middleware.js"),
      "/package/../dist/runtime/server/middleware.js",
    );
    equal(
      resolveRuntimeServerPath(resolver, "plugin.js"),
      "/package/../dist/runtime/server/plugin.js",
    );
    deepEqual(requestedPaths, [
      "../dist/runtime/server/middleware.js",
      "../dist/runtime/server/plugin.js",
    ]);
  },
);

test(
  "missing exports must throw, not silently return undefined",
  () => {
    const code = buildContextFactoryResolver("~/factory");
    const fn = new Function(
      "contextFactoryModule",
      code + "\nreturn contextDataFactory;",
    );

    // Module that exports neither `default` nor `contextDataFactory`
    const emptyModule = { somethingElse: () => ({}) };

    throws(
      () => fn(emptyModule),
      TypeError,
      "should throw when module exports neither default nor contextDataFactory",
    );
  },
);
