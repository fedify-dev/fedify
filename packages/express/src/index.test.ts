import type { Request as ERequest, Response as EResponse } from "express";
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { integrateFederation } from "./index.ts";

interface MockFederation {
  fetch(request: Request, options: unknown): Promise<Response>;
}

function createMockRequest(): ERequest {
  return {
    protocol: "http",
    host: "localhost",
    url: "/",
    method: "GET",
    headers: {},
  } as unknown as ERequest;
}

function createMockResponse(): {
  response: EResponse;
  ended: Promise<void>;
  getBody(): string;
} {
  let body = "";
  let resolveEnded: () => void;
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  const response = {
    statusCode: 200,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    setHeader() {
      return response;
    },
    removeHeader() {
      return response;
    },
    write(chunk: Buffer | string) {
      body += chunk.toString();
      return true;
    },
    end() {
      resolveEnded();
      return response;
    },
    send() {
      return response;
    },
    json() {
      return response;
    },
  };
  return {
    response: response as unknown as EResponse,
    ended,
    getBody: () => body,
  };
}

describe("integrateFederation()", () => {
  test("waits for an async contextDataFactory and passes the resolved value to federation.fetch()", async () => {
    let resolveContextData!: (value: string) => void;
    let fetchCalled = false;

    const mockFederation: MockFederation = {
      fetch(_request, options) {
        fetchCalled = true;
        const { contextData } = options as { contextData: unknown };
        return Promise.resolve(new Response(String(contextData)));
      },
    };

    const contextDataFactory = () =>
      new Promise<string>((resolve) => {
        resolveContextData = resolve;
      });

    const middleware = integrateFederation(
      mockFederation as never,
      contextDataFactory,
    );

    const req = createMockRequest();
    const { response, ended, getBody } = createMockResponse();
    let nextCalled = false;

    middleware(req, response, () => {
      nextCalled = true;
    });

    await Promise.resolve();
    assert.strictEqual(fetchCalled, false);

    resolveContextData("Hello World");
    await ended;

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(getBody(), "Hello World");
  });
});
