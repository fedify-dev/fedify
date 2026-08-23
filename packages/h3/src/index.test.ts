import type { Federation } from "@fedify/fedify";
import type { H3Event } from "h3";
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { integrateFederation } from "./index.ts";

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
});
