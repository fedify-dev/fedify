import { test } from "@fedify/fixture";
import { deepEqual, equal, ok } from "node:assert/strict";
import { once } from "node:events";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { interceptNotAcceptable, notAcceptableHeaders } from "./response.ts";

for (
  const signature of [
    "empty",
    "callback",
    "chunk-callback",
    "encoding",
  ] as const
) {
  test(`buffered 404 interception preserves end ${signature}`, async () => {
    let cleaned = 0;
    let called = 0;
    let callbackPromise: Promise<unknown> | undefined;
    const server = createServer((_request, response) => {
      const originalEnd = response.end;
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        response,
        "end",
      );
      response.statusCode = 404;
      response.setHeader("Vary", "Origin");
      response.setHeader("ETag", '"old"');
      response.setHeader("Content-Digest", "sha-256=:old:");
      response.setHeader("Digest", "SHA-256=old");
      response.setHeader("Content-Length", "100");
      interceptNotAcceptable(response, () => cleaned++);
      const callback = () => {
        called++;
        equal(response.end, originalEnd);
        deepEqual(
          Object.getOwnPropertyDescriptor(response, "end"),
          originalDescriptor,
        );
      };
      callbackPromise = once(response, "finish");
      if (signature === "empty") response.end();
      else if (signature === "callback") response.end(callback);
      else if (signature === "chunk-callback") {
        response.end("old body", callback);
      } else response.end("old body", "ascii", callback);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address();
      ok(address && typeof address !== "string");
      const result = await fetch(`http://127.0.0.1:${address.port}`, {
        headers: { Connection: "close" },
      });
      equal(result.status, 406);
      equal(result.statusText, "Not Acceptable");
      equal(await result.text(), "Not Acceptable");
      equal(result.headers.get("vary"), "Origin, Accept");
      equal(result.headers.get("content-type"), "text/plain");
      equal(result.headers.get("etag"), null);
      equal(result.headers.get("content-digest"), null);
      equal(result.headers.get("digest"), null);
      await callbackPromise;
      equal(cleaned, 1);
      equal(called, signature === "empty" ? 0 : 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  });
}

test("interception passes committed headers and successful streams through", async () => {
  for (const status of [200, 404]) {
    const server = createServer((_request, response) => {
      response.statusCode = status;
      response.setHeader("Content-Digest", "sha-256=:original:");
      response.setHeader("Digest", "SHA-256=original");
      interceptNotAcceptable(response, () => {});
      response.writeHead(status, { "Content-Type": "text/html" });
      response.write("first ");
      response.end("second");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address();
      ok(address && typeof address !== "string");
      const result = await fetch(`http://127.0.0.1:${address.port}`, {
        headers: { Connection: "close" },
      });
      equal(result.status, status);
      equal(await result.text(), "first second");
      equal(result.headers.get("content-digest"), "sha-256=:original:");
      equal(result.headers.get("digest"), "SHA-256=original");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      );
    }
  }
});

function mockResponse(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

test("interception restores an own end method and passes exact arguments", () => {
  const response = mockResponse();
  let received: unknown[] = [];
  const originalEnd = function (this: ServerResponse, ...args: unknown[]) {
    equal(this, response);
    received = args;
    return this;
  };
  response.end = originalEnd;
  let cleaned = 0;
  interceptNotAcceptable(response, () => cleaned++);
  const callback = () => {};
  equal(response.end("success", "ascii", callback), response);
  equal(response.end, originalEnd);
  deepEqual(received, ["success", "ascii", callback]);
  equal(cleaned, 1);
});

test("interception leaves a later wrapper intact and converts only once", () => {
  const response = mockResponse();
  const statuses: number[] = [];
  response.end = function (this: ServerResponse) {
    statuses.push(this.statusCode);
    return this;
  };
  response.statusCode = 404;
  let cleaned = 0;
  interceptNotAcceptable(response, () => cleaned++);
  const inner = response.end;
  const outer: ServerResponse["end"] = function (
    this: ServerResponse,
    ...args: unknown[]
  ): ServerResponse {
    return Reflect.apply(inner, this, args);
  };
  response.end = outer;
  response.end("first");
  equal(response.end, outer);
  response.statusCode = 404;
  response.end("second");
  deepEqual(statuses, [406, 404]);
  equal(cleaned, 1);
});

test("interception restores the response on aborted request close", () => {
  const response = mockResponse();
  const originalEnd = response.end;
  let cleaned = 0;
  interceptNotAcceptable(response, () => cleaned++);
  response.emit("close");
  equal(response.end, originalEnd);
  equal(Object.hasOwn(response, "end"), false);
  equal(cleaned, 1);
  equal(response.listenerCount("close"), 0);
});

test("replacement headers remove digests from both header sources", () => {
  const original = new Headers({
    "Content-Digest": "sha-256=:old-response:",
    Digest: "SHA-256=old-response",
    Vary: "Origin",
  });
  const eventHeaders = new Headers({
    "Content-Digest": "sha-256=:old-event:",
    Digest: "SHA-256=old-event",
    Vary: "Cookie",
  });
  const result = notAcceptableHeaders(original, eventHeaders);
  for (const name of ["content-digest", "digest"]) {
    equal(result.get(name), null);
    equal(eventHeaders.get(name), null);
  }
  equal(result.get("vary"), "Origin, Cookie, Accept");
});
