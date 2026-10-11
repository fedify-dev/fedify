import { createFederation, MemoryKvStore } from "@fedify/fedify";
import type { FetchEvent } from "@solidjs/start/server";
import { ok, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { createOnRequestHandler, onBeforeResponse } from "./handlers.ts";

function createEvent(request: Request, status?: number): FetchEvent {
  return {
    request,
    locals: {},
    nativeEvent: { handled: false, node: {} },
    response: { status, headers: new Headers() },
  } as unknown as FetchEvent;
}

// Runs onBeforeResponse() and returns the payload SolidStart would send.
function beforeResponse(event: FetchEvent, body?: unknown): unknown {
  const payload: { body?: unknown } = { body };
  onBeforeResponse(event, payload);
  return payload.body;
}

function createActorFederation() {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  return federation;
}

// Test the extracted handlers without loading SolidStart's JSX runtime.
describe("[solidstart] createOnRequestHandler()", () => {
  test("delegates an unregistered route to SolidStart", async () => {
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    const onRequest = createOnRequestHandler(federation, () => undefined);
    const event = createEvent(new Request("http://localhost/hello-world"));

    strictEqual(await onRequest(event), undefined);
    strictEqual(beforeResponse(createEvent(event.request, 404)), undefined);
  });

  test("delegates an unmatched route when federation routes are registered", async () => {
    const onRequest = createOnRequestHandler(
      createActorFederation(),
      () => undefined,
    );
    const event = createEvent(new Request("http://localhost/hello-world"));

    strictEqual(await onRequest(event), undefined);
    strictEqual(beforeResponse(createEvent(event.request, 404)), undefined);
  });

  test("delegates a registered route whose actor is not found", async () => {
    const onRequest = createOnRequestHandler(
      createActorFederation(),
      () => undefined,
    );
    const event = createEvent(
      new Request("http://localhost/users/missing", {
        headers: { Accept: "application/activity+json" },
      }),
    );

    strictEqual(await onRequest(event), undefined);
    strictEqual(beforeResponse(createEvent(event.request, 404)), undefined);
  });

  test("forwards a handled federation response unchanged", async () => {
    const expected = new Response("federation body", {
      status: 200,
      headers: {
        "Content-Type": "application/activity+json",
        "X-Custom-Header": "custom-value",
      },
    });
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    federation.fetch = () => Promise.resolve(expected);
    const onRequest = createOnRequestHandler(federation, () => undefined);
    const actual = await onRequest(
      createEvent(new Request("http://localhost/users/alice")),
    );

    strictEqual(actual, expected);
  });
});

describe("[solidstart] onBeforeResponse()", () => {
  test("keeps the payload when no 406 was deferred", () => {
    const event = createEvent(new Request("http://localhost/hello-world"), 404);

    strictEqual(beforeResponse(event), undefined);
  });

  for (
    const [name, status, body] of [
      ["a 404 status", 404, undefined],
      [
        "a returned 404 response",
        200,
        new Response("Not Found", { status: 404 }),
      ],
      ["no response", undefined, undefined],
    ] as const
  ) {
    test(`replaces ${name} with the deferred 406`, async () => {
      const onRequest = createOnRequestHandler(
        createActorFederation(),
        () => undefined,
      );
      const request = new Request("http://localhost/users/alice", {
        headers: { Accept: "text/html" },
      });

      strictEqual(await onRequest(createEvent(request)), undefined);
      const response = beforeResponse(createEvent(request, status), body);
      ok(response instanceof Response);
      strictEqual(response.status, 406);
      strictEqual(response.headers.get("Content-Type"), "text/plain");
      strictEqual(response.headers.get("Vary"), "Accept");
      strictEqual(await response.text(), "Not Acceptable");
    });
  }

  for (const status of [200, 500]) {
    test(`preserves the SolidStart response with status ${status}`, async () => {
      const onRequest = createOnRequestHandler(
        createActorFederation(),
        () => undefined,
      );
      const request = new Request("http://localhost/users/alice", {
        headers: { Accept: "text/html" },
      });
      const body = new Response("page", { status });

      strictEqual(await onRequest(createEvent(request)), undefined);
      strictEqual(beforeResponse(createEvent(request, status), body), body);
    });
  }

  test("keeps deferred responses separate for different requests", async () => {
    const onRequest = createOnRequestHandler(
      createActorFederation(),
      () => undefined,
    );
    const firstRequest = new Request("http://localhost/users/alice", {
      headers: { Accept: "text/html" },
    });
    const secondRequest = new Request(firstRequest);

    strictEqual(await onRequest(createEvent(firstRequest)), undefined);
    strictEqual(beforeResponse(createEvent(secondRequest, 404)), undefined);
    const response = beforeResponse(createEvent(firstRequest, 404));
    ok(response instanceof Response);
    strictEqual(response.status, 406);
  });
});
