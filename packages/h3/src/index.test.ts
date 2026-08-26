import type { Federation } from "@fedify/fedify";
import type { H3Error, H3Event } from "h3";
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { integrateFederation, onError } from "./index.ts";

interface MockFederation {
  fetch(request: Request, options: unknown): Promise<Response>;
}

function createMockEvent(request: Request): {
  event: H3Event;
  respondWithCalls: Response[];
} {
  const respondWithCalls: Response[] = [];
  const event = {
    web: { request },
    context: {},
    respondWith(response: Response) {
      respondWithCalls.push(response);
      return Promise.resolve();
    },
  };
  return { event: event as unknown as H3Event, respondWithCalls };
}

describe("integrateFederation()", () => {
  test("responds with the Fedify response when it is handled (e.g., 200 OK)", async () => {
    const okResponse = new Response("Hello, world!", { status: 200 });
    const mockFederation: MockFederation = {
      fetch() {
        return Promise.resolve(okResponse);
      },
    };
    const handler = integrateFederation(
      mockFederation as unknown as Federation<void>,
      () => undefined,
    );
    const { event, respondWithCalls } = createMockEvent(
      new Request("https://example.com/"),
    );

    await handler(event);

    assert.equal(respondWithCalls.length, 1);
    assert.equal(respondWithCalls[0], okResponse);
  });

  test("does not respond and delegates to the next handler on 404 Not Found", async () => {
    const mockFederation: MockFederation = {
      fetch() {
        return Promise.resolve(new Response(null, { status: 404 }));
      },
    };
    const handler = integrateFederation(
      mockFederation as unknown as Federation<void>,
      () => undefined,
    );
    const { event, respondWithCalls } = createMockEvent(
      new Request("https://example.com/"),
    );

    await handler(event);

    assert.equal(respondWithCalls.length, 0);
    assert.equal("__fedify_response__" in event.context, false);
  });

  test("stores the response in the event context on 406 Not Acceptable", async () => {
    const notAcceptableResponse = new Response(null, { status: 406 });
    const mockFederation: MockFederation = {
      fetch() {
        return Promise.resolve(notAcceptableResponse);
      },
    };
    const handler = integrateFederation(
      mockFederation as unknown as Federation<void>,
      () => undefined,
    );
    const { event, respondWithCalls } = createMockEvent(
      new Request("https://example.com/"),
    );

    await handler(event);

    assert.equal(respondWithCalls.length, 0);
    assert.equal(event.context["__fedify_response__"], notAcceptableResponse);
  });

  test("waits for an async contextDataFactory and passes the resolved value to federation.fetch()", async () => {
    let resolveContextData!: (value: string) => void;
    let fetchCalled = false;
    let receivedContextData: unknown;
    const mockFederation: MockFederation = {
      fetch(_request, options) {
        fetchCalled = true;
        const { contextData } = options as { contextData: unknown };
        receivedContextData = contextData;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    };
    const contextDataFactory = () =>
      new Promise<string>((resolve) => {
        resolveContextData = resolve;
      });
    const handler = integrateFederation(
      mockFederation as unknown as Federation<string>,
      contextDataFactory,
    );
    const { event } = createMockEvent(new Request("https://example.com/"));

    const handlerPromise = handler(event);
    await Promise.resolve();
    assert.equal(fetchCalled, false);

    resolveContextData("context data");
    await handlerPromise;

    assert.equal(fetchCalled, true);
    assert.equal(receivedContextData, "context data");
  });
});

describe("onError()", () => {
  function createMockError(statusCode: number): H3Error {
    return { statusCode } as unknown as H3Error;
  }

  test("responds with the stored 406 response when the handler later reports 404", async () => {
    const notAcceptableResponse = new Response(null, { status: 406 });
    const { event, respondWithCalls } = createMockEvent(
      new Request("https://example.com/"),
    );
    event.context["__fedify_response__"] = notAcceptableResponse;

    await onError(createMockError(404), event);

    assert.equal(respondWithCalls.length, 1);
    assert.equal(respondWithCalls[0], notAcceptableResponse);
  });

  test("does nothing when there is no stored 406 response", async () => {
    const { event, respondWithCalls } = createMockEvent(
      new Request("https://example.com/"),
    );

    await onError(createMockError(404), event);

    assert.equal(respondWithCalls.length, 0);
  });

  test("does nothing when the error status is not 404", async () => {
    const notAcceptableResponse = new Response(null, { status: 406 });
    const { event, respondWithCalls } = createMockEvent(
      new Request("https://example.com/"),
    );
    event.context["__fedify_response__"] = notAcceptableResponse;

    await onError(createMockError(500), event);

    assert.equal(respondWithCalls.length, 0);
  });
});
