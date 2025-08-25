import { assertEquals } from "@std/assert";
import { fedifyHook } from "./mod.ts";

interface MockRequestEvent {
  request: Request;
}

interface MockHookParams {
  event: MockRequestEvent;
  resolve: (event: MockRequestEvent) => Promise<Response>;
}

interface MockFederation<T> {
  fetch(request: Request, options: any): Promise<Response>;
}

Deno.test("fedifyHook", async (t) => {
  await t.step("creates hook handler function", () => {
    const mockFederation: MockFederation<undefined> = {
      fetch: async () => new Response("OK"),
    };

    const createContextData = () => undefined;

    const hookHandler = fedifyHook(mockFederation as any, createContextData);
    assertEquals(typeof hookHandler, "function");
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

    const createContextData = () => "test-context";

    const hookHandler = fedifyHook(mockFederation as any, createContextData);

    const mockRequest = new Request("https://example.com/test");
    const mockEvent: MockRequestEvent = { request: mockRequest };
    const mockResolve = async () => new Response("SvelteKit response");

    const result = await hookHandler({
      event: mockEvent,
      resolve: mockResolve,
    });

    assertEquals(capturedRequest, mockRequest);
    assertEquals(capturedOptions.contextData, "test-context");
    assertEquals(result.status, 200);
  });

  await t.step("handles async context data creation", async () => {
    let capturedContextData: any;

    const mockFederation: MockFederation<string> = {
      fetch: async (request, options) => {
        capturedContextData = options.contextData;
        return new Response("OK");
      },
    };

    const createContextData = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "async-context";
    };

    const hookHandler = fedifyHook(mockFederation as any, createContextData);

    const mockRequest = new Request("https://example.com/test");
    const mockEvent: MockRequestEvent = { request: mockRequest };
    const mockResolve = async () => new Response("SvelteKit response");

    await hookHandler({ event: mockEvent, resolve: mockResolve });

    assertEquals(capturedContextData, "async-context");
  });
});
