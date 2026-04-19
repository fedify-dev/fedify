import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

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
    {
      fetch(
        request: Request,
        options: {
          contextData: string;
          onNotAcceptable(request: Request): Promise<Response>;
        },
      ) {
        capturedRequest = request;
        capturedContextData = options.contextData;
        return options.onNotAcceptable(request);
      },
    } as never,
    () => "test-context",
  );

  const request = new Request("https://example.com/");
  const response = expectResponse(await middleware(
    { request } as never,
    () => Promise.resolve(new Response("Not found", { status: 404 })),
  ));
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
      {
        fetch(
          _request: Request,
          options: { onNotFound(request: Request): Promise<Response> },
        ) {
          return options.onNotFound(new Request("https://example.com/actor"));
        },
      } as never,
      () => undefined,
    );

    const response = expectResponse(await middleware(
      { request: new Request("https://example.com/inbox") } as never,
      () => {
        nextCalled = true;
        return Promise.resolve(new Response("Handled by Astro"));
      },
    ));

    strictEqual(nextCalled, true);
    strictEqual(response.status, 200);
    strictEqual(await response.text(), "Handled by Astro");
  },
);
