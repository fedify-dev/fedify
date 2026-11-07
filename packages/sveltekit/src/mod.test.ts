import { strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { fedifyHook } from "./mod.ts";
import type { RequestEvent } from "@sveltejs/kit";

interface MockFederation {
  fetch(request: Request, options: unknown): Promise<Response>;
}

describe("fedifyHook", () => {
  test("creates hook handler function", () => {
    const mockFederation = {
      fetch: () => Promise.resolve(new Response("OK")),
    };

    const hookHandler = fedifyHook(mockFederation as never);
    strictEqual(typeof hookHandler, "function");
  });

  test("calls federation.fetch with correct parameters", async () => {
    let capturedRequest: Request | undefined;
    let capturedOptions: unknown;

    const mockFederation: MockFederation = {
      fetch: (request, options) => {
        capturedRequest = request;
        capturedOptions = options;
        return Promise.resolve(new Response("Federation response"));
      },
    };

    const createContextData = () => "test-context";

    const hookHandler = fedifyHook(mockFederation as never, createContextData);

    const mockRequest = new Request("https://example.com/test");
    const mockEvent: RequestEvent = { request: mockRequest } as RequestEvent;
    const mockResolve = () =>
      Promise.resolve(new Response("SvelteKit response"));

    const result = await hookHandler({
      event: mockEvent,
      resolve: mockResolve,
    });

    strictEqual(capturedRequest, mockRequest);
    strictEqual(
      (capturedOptions as { contextData: string }).contextData,
      "test-context",
    );
    strictEqual(result.status, 200);
  });

  test("handles async context data creation", async () => {
    let capturedContextData: unknown;

    const mockFederation: MockFederation = {
      fetch: (_request, options) => {
        capturedContextData = (options as { contextData: string }).contextData;
        return Promise.resolve(new Response("OK"));
      },
    };

    const createContextData = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "async-context";
    };

    const hookHandler = fedifyHook(mockFederation as never, createContextData);

    const mockRequest = new Request("https://example.com/test");
    const mockEvent: RequestEvent = { request: mockRequest } as RequestEvent;
    const mockResolve = () =>
      Promise.resolve(new Response("SvelteKit response"));

    await hookHandler({ event: mockEvent, resolve: mockResolve });

    strictEqual(capturedContextData, "async-context");
  });
});
