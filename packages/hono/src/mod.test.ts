import { strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { type ContextDataFactory, federation } from "./mod.ts";

interface MockHonoContext {
  req: {
    raw: Request;
  };
  res: Response;
}

// The unused type parameter keeps the mock generic at its call sites.
// oxlint-disable-next-line eslint/no-unused-vars
interface MockFederation<T> {
  fetch(request: Request, options: unknown): Promise<Response>;
}

describe("federation middleware", () => {
  test("creates middleware function", () => {
    const mockFederation: MockFederation<undefined> = {
      fetch: () => Promise.resolve(new Response("OK")),
    };

    const contextDataFactory: ContextDataFactory<
      undefined,
      MockHonoContext
    > = () => undefined;

    const middleware = federation(mockFederation as never, contextDataFactory);
    strictEqual(typeof middleware, "function");
  });

  test("calls federation.fetch with correct parameters", async () => {
    let capturedRequest: Request | undefined;
    let capturedOptions: unknown;

    const mockFederation: MockFederation<string> = {
      fetch: (request, options) => {
        capturedRequest = request;
        capturedOptions = options;
        return Promise.resolve(new Response("Federation response"));
      },
    };

    const contextDataFactory: ContextDataFactory<
      string,
      MockHonoContext
    > = () => "test-context";

    const middleware = federation(mockFederation as never, contextDataFactory);

    const mockRequest = new Request("https://example.com/test");
    const mockContext: MockHonoContext = {
      req: { raw: mockRequest },
      res: new Response("Hono response"),
    };

    const result = await middleware(mockContext, () => Promise.resolve());

    strictEqual(capturedRequest, mockRequest);
    strictEqual(
      (capturedOptions as { contextData: string }).contextData,
      "test-context",
    );
    strictEqual(result?.status, 200);
  });

  test("handles async context data factory", async () => {
    const ASYNC_CONTEXT = "async-context" as const;
    const capturedContextData: { contextData?: typeof ASYNC_CONTEXT } = {};

    const mockFederation: MockFederation<typeof ASYNC_CONTEXT> = {
      fetch: (_request, options: { contextData: typeof ASYNC_CONTEXT }) => {
        capturedContextData.contextData = options.contextData;
        return Promise.resolve(new Response("OK"));
      },
    };

    const contextDataFactory: ContextDataFactory<
      typeof ASYNC_CONTEXT,
      MockHonoContext
    > = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ASYNC_CONTEXT;
    };

    const middleware = federation(mockFederation as never, contextDataFactory);

    const mockRequest = new Request("https://example.com/test");
    const mockContext: MockHonoContext = {
      req: { raw: mockRequest },
      res: new Response("Hono response"),
    };

    await middleware(mockContext, () => Promise.resolve());

    strictEqual(capturedContextData.contextData, ASYNC_CONTEXT);
  });
});
