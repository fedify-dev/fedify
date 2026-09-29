import { createFederation, MemoryKvStore } from "@fedify/fedify";
import type { FetchEvent } from "@solidjs/start/server";
import { ok, strictEqual } from "node:assert/strict";
import { describe, test } from "node:test";
import { createOnRequestHandler, onBeforeResponse } from "./handlers.ts";

function createEvent(request: Request, status?: number): FetchEvent {
  return {
    request,
    locals: {},
    response: { status },
  } as unknown as FetchEvent;
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
    strictEqual(onBeforeResponse(createEvent(event.request, 404)), undefined);
  });

  test("delegates an unmatched route when federation routes are registered", async () => {
    const onRequest = createOnRequestHandler(
      createActorFederation(),
      () => undefined,
    );
    const event = createEvent(new Request("http://localhost/hello-world"));

    strictEqual(await onRequest(event), undefined);
    strictEqual(onBeforeResponse(createEvent(event.request, 404)), undefined);
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
    strictEqual(onBeforeResponse(createEvent(event.request, 404)), undefined);
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
  test("returns no response when no 406 was deferred", () => {
    const event = createEvent(new Request("http://localhost/hello-world"), 404);

    strictEqual(onBeforeResponse(event), undefined);
  });

  test("returns the deferred 406 when SolidStart returns 404 and consumes it", async () => {
    const onRequest = createOnRequestHandler(
      createActorFederation(),
      () => undefined,
    );
    const request = new Request("http://localhost/users/alice", {
      headers: { Accept: "text/html" },
    });

    strictEqual(await onRequest(createEvent(request)), undefined);
    const event = createEvent(request, 404);
    const response = onBeforeResponse(event);

    ok(response);
    strictEqual(response.status, 406);
    strictEqual(response.headers.get("Content-Type"), "text/plain");
    strictEqual(response.headers.get("Vary"), "Accept");
    strictEqual(await response.text(), "Not Acceptable");
    strictEqual(onBeforeResponse(event), undefined);
  });

  for (const status of [200, 500, undefined]) {
    test(`preserves the SolidStart response with status ${status} and clears the deferred 406`, async () => {
      const onRequest = createOnRequestHandler(
        createActorFederation(),
        () => undefined,
      );
      const request = new Request("http://localhost/users/alice", {
        headers: { Accept: "text/html" },
      });

      strictEqual(await onRequest(createEvent(request)), undefined);
      strictEqual(onBeforeResponse(createEvent(request, status)), undefined);
      strictEqual(onBeforeResponse(createEvent(request, 404)), undefined);
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
    strictEqual(onBeforeResponse(createEvent(secondRequest, 404)), undefined);
    const response = onBeforeResponse(createEvent(firstRequest, 404));
    ok(response);
    strictEqual(response.status, 406);
  });
});
