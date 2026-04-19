import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type {
  Federation,
  FederationFetchOptions,
} from "@fedify/fedify/federation";
import type { APIContext } from "astro";

const require = createRequire(import.meta.url);

type MockFederation<TContextData> = Pick<Federation<TContextData>, "fetch">;

function toFederation<TContextData>(
  federation: MockFederation<TContextData>,
): Federation<TContextData> {
  return federation as Federation<TContextData>;
}

function toApiContext(context: Pick<APIContext, "request">): APIContext {
  return context as APIContext;
}

function expectResponse(response: void | Response): Response {
  if (!(response instanceof Response)) {
    throw new TypeError("Expected middleware to return a Response");
  }
  return response;
}

test("self-reference ESM import exposes working Astro integration API", async () => {
  const mod = await import("@fedify/astro");

  strictEqual(typeof mod.fedifyIntegration, "function");
  strictEqual(typeof mod.fedifyMiddleware, "function");

  const integration = mod.fedifyIntegration();
  strictEqual(integration.name, "@fedify/astro");

  let capturedConfig: unknown;
  (
    integration.hooks as Record<
      "astro:config:setup",
      (args: { updateConfig(config: unknown): void }) => void
    >
  )["astro:config:setup"]({
    updateConfig(config) {
      capturedConfig = config;
    },
  });
  deepStrictEqual(capturedConfig, {
    vite: {
      ssr: {
        noExternal: ["@fedify/fedify", "@fedify/vocab"],
      },
    },
  });

  let capturedRequest: Request | undefined;
  let capturedContextData: unknown;
  const middleware = mod.fedifyMiddleware(
    toFederation<string>({
      async fetch(
        request: Request,
        options: FederationFetchOptions<string>,
      ) {
        capturedRequest = request;
        capturedContextData = options.contextData;
        if (options.onNotAcceptable == null) {
          throw new TypeError("Expected onNotAcceptable to be defined");
        }
        return options.onNotAcceptable(request);
      },
    }),
    () => "test-context",
  );

  const request = new Request("https://example.com/");
  const response = expectResponse(
    await middleware(
      toApiContext({ request }),
      () => Promise.resolve(new Response("Not found", { status: 404 })),
    ),
  );
  strictEqual(capturedRequest, request);
  strictEqual(capturedContextData, "test-context");
  strictEqual(response.status, 406);
  strictEqual(response.headers.get("Vary"), "Accept");
});

test(
  "self-reference CommonJS require exposes working Astro middleware API",
  { skip: "Deno" in globalThis },
  async () => {
    const mod = require("@fedify/astro") as typeof import("@fedify/astro");

    strictEqual(typeof mod.fedifyIntegration, "function");
    strictEqual(typeof mod.fedifyMiddleware, "function");

    let nextCalled = false;
    const middleware = mod.fedifyMiddleware(
      toFederation<void>({
        async fetch(
          _request: Request,
          options: FederationFetchOptions<void>,
        ) {
          if (options.onNotFound == null) {
            throw new TypeError("Expected onNotFound to be defined");
          }
          return options.onNotFound(new Request("https://example.com/actor"));
        },
      }),
      () => undefined,
    );

    const response = expectResponse(
      await middleware(
        toApiContext({ request: new Request("https://example.com/inbox") }),
        () => {
          nextCalled = true;
          return Promise.resolve(new Response("Handled by Astro"));
        },
      ),
    );

    strictEqual(nextCalled, true);
    strictEqual(response.status, 200);
    strictEqual(await response.text(), "Handled by Astro");
  },
);
