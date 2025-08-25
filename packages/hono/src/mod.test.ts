import { assertEquals } from "@std/assert";
import { type ContextDataFactory, federation } from "./mod.ts";

interface MockHonoContext {
  req: {
    raw: Request;
  };
  res: Response;
}

interface MockFederation<T> {
  fetch(request: Request, options: any): Promise<Response>;
}

Deno.test("federation middleware", async (t) => {
  await t.step("creates middleware function", () => {
    const mockFederation: MockFederation<undefined> = {
      fetch: async () => new Response("OK"),
    };

    const contextDataFactory: ContextDataFactory<undefined, MockHonoContext> =
      () => undefined;

    const middleware = federation(mockFederation as any, contextDataFactory);
    assertEquals(typeof middleware, "function");
  });

  await t.step("calls federation.fetch with correct parameters", async () => {
    let capturedRequest: Request | undefined;
    let capturedOptions: any;

    const mockFederation: MockFederation<string> = {
      fetch: async (request, options) => {
        capturedRequest = request;
        capturedOptions = options;
        return new Response("Federation response");
      },
    };

    const contextDataFactory: ContextDataFactory<string, MockHonoContext> =
      () => "test-context";

    const middleware = federation(mockFederation as any, contextDataFactory);

    const mockRequest = new Request("https://example.com/test");
    const mockContext: MockHonoContext = {
      req: { raw: mockRequest },
      res: new Response("Hono response"),
    };

    const result = await middleware(mockContext, async () => {});

    assertEquals(capturedRequest, mockRequest);
    assertEquals(capturedOptions.contextData, "test-context");
    assertEquals(result?.status, 200);
  });

  await t.step("handles async context data factory", async () => {
    let capturedContextData: any;

    const mockFederation: MockFederation<string> = {
      fetch: async (request, options) => {
        capturedContextData = options.contextData;
        return new Response("OK");
      },
    };

    const contextDataFactory: ContextDataFactory<string, MockHonoContext> =
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "async-context";
      };

    const middleware = federation(mockFederation as any, contextDataFactory);

    const mockRequest = new Request("https://example.com/test");
    const mockContext: MockHonoContext = {
      req: { raw: mockRequest },
      res: new Response("Hono response"),
    };

    await middleware(mockContext, async () => {});

    assertEquals(capturedContextData, "async-context");
  });
});
