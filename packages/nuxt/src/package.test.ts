import { test } from "@fedify/fixture";
import fedifyNuxtModule from "@fedify/nuxt";
import { runWithNuxtContext } from "@nuxt/kit";
import type { Nuxt } from "@nuxt/schema";
import { equal, match, ok } from "node:assert/strict";

interface TestNuxt {
  options: {
    rootDir: string;
    alias: Record<string, string>;
    _requiredModules?: Record<string, boolean>;
    experimental: Record<string, unknown>;
    serverHandlers: Array<{
      route: string;
      middleware: boolean;
      handler: string;
      method?: string;
    }>;
    devServerHandlers: unknown[];
    nitro: {
      virtual?: Record<string, () => string>;
      plugins?: string[];
    };
  };
  hooks: {
    addHooks(): void;
    callHook(): void;
  };
  hook(): void;
  callHook(): void;
}

function createNuxtFixture(): TestNuxt {
  return {
    options: {
      rootDir: "/app",
      alias: { "~": "/app", "@": "/app" },
      experimental: {},
      serverHandlers: [],
      devServerHandlers: [],
      nitro: {},
    },
    hooks: {
      addHooks: () => undefined,
      callHook: () => undefined,
    },
    hook: () => undefined,
    callHook: () => undefined,
  };
}

test("package import registers built runtime files", async () => {
  const nuxt = createNuxtFixture();
  const nuxtContext = nuxt as unknown as Nuxt;

  await runWithNuxtContext(
    nuxtContext,
    () =>
      fedifyNuxtModule({ federationModule: "#server/federation" }, nuxtContext),
  );

  equal(nuxt.options.serverHandlers.length, 1);
  equal(nuxt.options.serverHandlers[0].handler, "fedify-nuxt-options.mjs");

  const getContents = nuxt.options.nitro.virtual?.["fedify-nuxt-options.mjs"];
  if (getContents == null) {
    throw new TypeError("Expected fedify-nuxt-options.mjs to be registered.");
  }

  const contents = getContents();
  match(
    contents,
    /import \{ createFedifyMiddleware \} from ".+\/dist\/runtime\/server\/middleware\.js";/,
  );
  ok(!contents.includes("src/runtime"));
  ok(!contents.includes("middleware.ts"));

  const [plugin] = nuxt.options.nitro.plugins ?? [];
  ok(plugin != null);
  match(plugin, /\/dist\/runtime\/server\/plugin\.js$/);
});
