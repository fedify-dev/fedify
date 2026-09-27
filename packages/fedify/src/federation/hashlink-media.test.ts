import {
  createTestMeterProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { Note } from "@fedify/vocab";
import {
  computeDigestMultibase,
  encodeMultibase,
  exportDidKey,
} from "@fedify/vocab-runtime";
import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { ed25519PublicKey } from "../testing/keys.ts";
import { createFederationBuilder } from "./builder.ts";
import type { HashlinkMediaRequest } from "./callback.ts";
import type { RequestContext } from "./context.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";
import { parseHashlinkGatewayRequest } from "./portable.ts";
import { RouterError } from "./router.ts";

const textDecoder = new TextDecoder();

// The example in the Media section of FEP-ef61:
const FEP_DIGEST = "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n";

const mediaBytes = new TextEncoder().encode("Hello, portable world!");
const mediaDigest = await computeDigestMultibase(mediaBytes);
const mediaSha256 = new Uint8Array(
  await crypto.subtle.digest("SHA-256", mediaBytes),
);

// A SHA-256 digest whose base64 encoding contains slashes:
const ffDigest = new Uint8Array(32).fill(0xff);
const ffMultihash = new Uint8Array([0x12, 0x20, ...ffDigest]);
const ffBase64 = textDecoder.decode(encodeMultibase("base64", ffMultihash));
const ffBase58 = textDecoder.decode(encodeMultibase("base58btc", ffMultihash));

function mediaUrl(hashlink: string): string {
  return `https://example.com/.well-known/apgateway/${hashlink}`;
}

function parse(url: string) {
  return parseHashlinkGatewayRequest(new URL(url));
}

function assertMedia(url: string): HashlinkMediaRequest {
  const result = parse(url);
  assert(result != null, `${url} should be a hashlink media request`);
  if (result.type !== "media") {
    throw new Error(`${url} should not be malformed: ${result.error}`);
  }
  return result.media;
}

function assertMalformed(url: string): void {
  const result = parse(url);
  assert(result != null, `${url} should be a hashlink media request`);
  assertEquals(result.type, "malformed", url);
  if (result.type === "malformed") assertInstanceOf(result.error, TypeError);
}

function createTestFederation() {
  return createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
}

test("parseHashlinkGatewayRequest()", async (t) => {
  await t.step("parses a hashlink", () => {
    const media = assertMedia(mediaUrl(`hl:${mediaDigest}`));
    assertEquals(media.hashlink, `hl:${mediaDigest}`);
    assertEquals(media.digestMultibase, mediaDigest);
    assertEquals(media.algorithm, "sha2-256");
    assertEquals(media.digest, mediaSha256);
    assertEquals(media.multihash, new Uint8Array([0x12, 0x20, ...mediaSha256]));
    assert(Object.isFrozen(media));
  });

  await t.step("parses the example of FEP-ef61", () => {
    const media = assertMedia(mediaUrl(`hl:${FEP_DIGEST}`));
    assertEquals(media.digestMultibase, FEP_DIGEST);
    assertEquals(media.digest.length, 32);
  });

  await t.step("normalizes the scheme and percent-encoding", () => {
    for (const hashlink of [`HL:${mediaDigest}`, `hl%3a${mediaDigest}`]) {
      const media = assertMedia(mediaUrl(hashlink));
      assertEquals(media.hashlink, `hl:${mediaDigest}`);
      assertEquals(media.digestMultibase, mediaDigest);
    }
  });

  await t.step("accepts slashes in a base64 digest", () => {
    assert(ffBase64.includes("/"));
    for (
      const hashlink of [
        `hl:${ffBase64}`,
        `hl:${ffBase64.replaceAll("/", "%2F")}`,
      ]
    ) {
      const media = assertMedia(mediaUrl(hashlink));
      assertEquals(media.digestMultibase, ffBase64);
      assertEquals(media.digest, ffDigest);
      assertEquals(media.multihash, ffMultihash);
    }
  });

  await t.step("keeps the requested multibase encoding", () => {
    const base58 = assertMedia(mediaUrl(`hl:${ffBase58}`));
    const base64 = assertMedia(mediaUrl(`hl:${ffBase64}`));
    assertEquals(base58.digestMultibase, ffBase58);
    assertEquals(base64.digestMultibase, ffBase64);
    assertEquals(base58.digest, base64.digest);
    assertEquals(base58.multihash, base64.multihash);
  });

  await t.step("ignores the query", () => {
    const media = assertMedia(mediaUrl(`hl:${mediaDigest}?v=1`));
    assertEquals(media.digestMultibase, mediaDigest);
  });

  await t.step("returns fresh digest bytes", () => {
    const a = assertMedia(mediaUrl(`hl:${mediaDigest}`));
    const b = assertMedia(mediaUrl(`hl:${mediaDigest}`));
    a.digest.fill(0);
    a.multihash.fill(0);
    assertEquals(b.digest, mediaSha256);
  });

  await t.step("ignores other URLs", async () => {
    const did = await exportDidKey(ed25519PublicKey.publicKey);
    for (
      const url of [
        "https://example.com/.well-known/apgateway",
        "https://example.com/.well-known/apgateway/",
        `https://example.com/.well-known/apgateway/${did}/notes/1`,
        `https://example.com/.WELL-KNOWN/apgateway/hl:${mediaDigest}`,
        `https://example.com/.well-known/apgateway-media/hl:${mediaDigest}`,
        `https://example.com/hl:${mediaDigest}`,
        `https://example.com/.well-known/apgateway/x/hl:${mediaDigest}`,
        `https://example.com/.well-known/apgateway/hlx${mediaDigest}`,
      ]
    ) {
      assertStrictEquals(parse(url), null, url);
    }
  });

  await t.step("recognizes malformed hashlinks", () => {
    const sha512 = textDecoder.decode(
      encodeMultibase(
        "base58btc",
        new Uint8Array([0x13, 0x40, ...new Uint8Array(64)]),
      ),
    );
    const short = textDecoder.decode(
      encodeMultibase(
        "base58btc",
        new Uint8Array([0x12, 0x10, ...new Uint8Array(16)]),
      ),
    );
    for (
      const hashlink of [
        "hl:",
        "hl:z",
        "hl:zInvalid0OIl",
        `hl:${sha512}`,
        `hl:${short}`,
        `hl:${mediaDigest}:zCwPSdabLuj3jue1qYujzunnKwpL4myKdyeqySyFhnzZ8qdfW3bb6W8dVdRu`,
        `hl:${mediaDigest}/`,
        `hl:${mediaDigest}/extra`,
        `hl:${mediaDigest}%E0%A4%A`,
        `hl:${mediaDigest}%0A`,
      ]
    ) {
      assertMalformed(mediaUrl(hashlink));
    }
  });
});

test("Federation.fetch() serves hashlink media", async (t) => {
  await t.step("passes the parsed hashlink to the dispatcher", async () => {
    const federation = createTestFederation();
    const calls: [RequestContext<void>, HashlinkMediaRequest][] = [];
    federation.setHashlinkMediaDispatcher((ctx, media) => {
      calls.push([ctx, media]);
      return new Response(mediaBytes, {
        headers: { "Content-Type": "text/plain" },
      });
    });
    const response = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}?download=1`)),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "text/plain");
    assertEquals(new Uint8Array(await response.arrayBuffer()), mediaBytes);
    assertEquals(calls.length, 1);
    const [ctx, media] = calls[0];
    assertEquals(ctx.request.url, mediaUrl(`hl:${mediaDigest}?download=1`));
    assertEquals(ctx.url.href, mediaUrl(`hl:${mediaDigest}?download=1`));
    assertEquals(media.hashlink, `hl:${mediaDigest}`);
    assertEquals(media.digestMultibase, mediaDigest);
    assertEquals(media.algorithm, "sha2-256");
    assertEquals(media.digest, mediaSha256);
  });

  await t.step("sends the response of the dispatcher as is", async () => {
    const federation = createTestFederation();
    let pulled = 0;
    let dispatched: Response | undefined;
    federation.setHashlinkMediaDispatcher(() => {
      // A body that never ends, so reading it through would hang:
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          controller.enqueue(mediaBytes.subarray(0, 4));
        },
      }, { highWaterMark: 0 });
      dispatched = new Response(body, {
        status: 206,
        statusText: "Partial Content",
        headers: {
          "Content-Type": "image/png",
          "Content-Range": "bytes 0-3/22",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Disposition": "attachment",
          ETag: `"${mediaDigest}"`,
          "Accept-Ranges": "bytes",
        },
      });
      return dispatched;
    });
    const response = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`), {
        headers: { Range: "bytes=0-3" },
      }),
      { contextData: undefined },
    );
    assertStrictEquals(response, dispatched);
    assertEquals(pulled, 0);
    assertEquals(response.status, 206);
    assertEquals(response.statusText, "Partial Content");
    assertEquals(response.headers.get("Content-Range"), "bytes 0-3/22");
    assertEquals(
      response.headers.get("Cache-Control"),
      "public, max-age=31536000, immutable",
    );
    assertEquals(response.headers.get("Content-Disposition"), "attachment");
    assertEquals(response.headers.get("ETag"), `"${mediaDigest}"`);
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    assertEquals(chunk.value, mediaBytes.subarray(0, 4));
    await reader.cancel();
  });

  await t.step("does not touch the Vary header", async () => {
    const federation = createTestFederation();
    federation.setHashlinkMediaDispatcher(() =>
      new Response(mediaBytes, { headers: { Vary: "Accept-Encoding" } })
    );
    const response = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`), {
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.headers.get("Vary"), "Accept-Encoding");
  });

  await t.step("sends responses with immutable headers", async () => {
    const federation = createTestFederation();
    federation.setHashlinkMediaDispatcher(() =>
      Response.redirect("https://cdn.example/media.png", 302)
    );
    const response = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`), {
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("Location"),
      "https://cdn.example/media.png",
    );
  });

  await t.step("responds with 404 if the dispatcher returns null", async () => {
    const federation = createTestFederation();
    federation.setHashlinkMediaDispatcher(() => null);
    const response = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`)),
      { contextData: undefined },
    );
    assertEquals(response.status, 404);
    const custom = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`)),
      {
        contextData: undefined,
        onNotFound: () => new Response("Nope.", { status: 404 }),
      },
    );
    assertEquals(custom.status, 404);
    assertEquals(await custom.text(), "Nope.");
  });

  await t.step("responds with 400 to malformed hashlinks", async () => {
    const federation = createTestFederation();
    let called = false;
    federation.setHashlinkMediaDispatcher(() => {
      called = true;
      return new Response(mediaBytes);
    });
    for (
      const hashlink of [
        "hl:zInvalid",
        `hl:${mediaDigest}/`,
        `hl:${mediaDigest}:z123`,
      ]
    ) {
      const response = await federation.fetch(
        new Request(mediaUrl(hashlink)),
        { contextData: undefined },
      );
      assertEquals(response.status, 400, hashlink);
      assertEquals(
        response.headers.get("Content-Type"),
        "text/plain; charset=utf-8",
      );
    }
    assertFalse(called);
  });

  await t.step("responds with 405 to other methods", async () => {
    const federation = createTestFederation();
    let called = false;
    federation.setHashlinkMediaDispatcher(() => {
      called = true;
      return new Response(mediaBytes);
    });
    for (const hashlink of [`hl:${mediaDigest}`, "hl:zInvalid"]) {
      const response = await federation.fetch(
        new Request(mediaUrl(hashlink), { method: "POST", body: mediaBytes }),
        { contextData: undefined },
      );
      assertEquals(response.status, 405);
      assertEquals(response.headers.get("Allow"), "GET, HEAD");
    }
    assertFalse(called);
  });

  await t.step("responds to HEAD requests without bodies", async () => {
    const federation = createTestFederation();
    let cancelled = false;
    let method: string | undefined;
    federation.setHashlinkMediaDispatcher((ctx) => {
      method = ctx.request.method;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(mediaBytes);
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": mediaBytes.length.toString(),
        },
      });
    });
    const response = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`), { method: "HEAD" }),
      { contextData: undefined },
    );
    assertEquals(method, "HEAD");
    assertEquals(response.status, 200);
    assertStrictEquals(response.body, null);
    assert(cancelled);
    assertEquals(response.headers.get("Content-Type"), "image/png");
    assertEquals(
      response.headers.get("Content-Length"),
      mediaBytes.length.toString(),
    );

    const malformed = await federation.fetch(
      new Request(mediaUrl("hl:zInvalid"), { method: "HEAD" }),
      { contextData: undefined },
    );
    assertEquals(malformed.status, 400);
    assertStrictEquals(malformed.body, null);
  });

  await t.step("does not wait for cancelling a cloned body", async () => {
    const federation = createTestFederation();
    // The original stays unconsumed, so cancelling the clone never settles:
    const cached = new Response(mediaBytes, {
      headers: { "Content-Type": "image/png" },
    });
    federation.setHashlinkMediaDispatcher(() => cached.clone());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      federation.fetch(
        new Request(mediaUrl(`hl:${mediaDigest}`), { method: "HEAD" }),
        { contextData: undefined },
      ),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1000);
      }),
    ]);
    clearTimeout(timer);
    assert(response != null, "the HEAD response should not hang");
    assertEquals(response.status, 200);
    assertStrictEquals(response.body, null);
    assertEquals(response.headers.get("Content-Type"), "image/png");
    await cached.body!.cancel();
  });

  await t.step("returns onNotFound responses as is", async () => {
    // Integrations, e.g., the Fastify plugin, recognize their onNotFound
    // responses by identity to fall back to their own routes:
    const federation = createTestFederation();
    federation.setHashlinkMediaDispatcher(() => null);
    const notFound = new Response("", { status: 404 });
    for (const method of ["GET", "HEAD"]) {
      const response = await federation.fetch(
        new Request(mediaUrl(`hl:${mediaDigest}`), { method }),
        { contextData: undefined, onNotFound: () => notFound },
      );
      assertStrictEquals(response, notFound, method);
    }
  });

  await t.step("propagates errors thrown by the dispatcher", async () => {
    const federation = createTestFederation();
    const error = new Error("Storage is down.");
    federation.setHashlinkMediaDispatcher(() => {
      throw error;
    });
    let thrown: unknown;
    try {
      await federation.fetch(new Request(mediaUrl(`hl:${mediaDigest}`)), {
        contextData: undefined,
      });
    } catch (e) {
      thrown = e;
    }
    assertStrictEquals(thrown, error);
  });

  await t.step("records metrics", async () => {
    const [meterProvider, recorder] = createTestMeterProvider();
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => mockDocumentLoader,
      meterProvider,
    });
    federation.setHashlinkMediaDispatcher(() => new Response(mediaBytes));
    await federation.fetch(new Request(mediaUrl(`hl:${mediaDigest}`)), {
      contextData: undefined,
    });
    await federation.fetch(new Request(mediaUrl("hl:zInvalid")), {
      contextData: undefined,
    });
    const counts = recorder.getMeasurements("fedify.http.server.request.count");
    assertEquals(counts.length, 2);
    for (
      const [count, status] of [[counts[0], 200], [counts[1], 400]] as const
    ) {
      assertEquals(count.attributes["fedify.endpoint"], "hashlink_media");
      assertEquals(count.attributes["http.response.status_code"], status);
      assertEquals(
        count.attributes["fedify.route.template"],
        "/.well-known/apgateway/hl:{digestMultibase}",
      );
    }
  });
});

test("Federation.fetch() routes hashlink media apart from other routes", async (t) => {
  const did = await exportDidKey(ed25519PublicKey.publicKey);

  await t.step("responds with 404 without a dispatcher", async () => {
    const federation = createTestFederation();
    for (const method of ["GET", "POST"]) {
      const response = await federation.fetch(
        new Request(mediaUrl(`hl:${mediaDigest}`), { method }),
        { contextData: undefined },
      );
      assertEquals(response.status, 404, method);
    }
    const malformed = await federation.fetch(
      new Request(mediaUrl("hl:zInvalid")),
      { contextData: undefined },
    );
    assertEquals(malformed.status, 404);
  });

  await t.step("keeps portable objects apart from media", async () => {
    const federation = createTestFederation();
    const objectCalls: Record<string, string>[] = [];
    let mediaCalled = false;
    federation.setObjectDispatcher(Note, "/notes/{id}", (_ctx, values) => {
      objectCalls.push(values);
      return null;
    });
    federation.setHashlinkMediaDispatcher(() => {
      mediaCalled = true;
      return null;
    });
    const response = await federation.fetch(
      new Request(`https://example.com/.well-known/apgateway/${did}/notes/1`, {
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 404);
    assertEquals(objectCalls, [{ id: "1" }]);
    assertFalse(mediaCalled);

    await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`), {
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assert(mediaCalled);
    assertEquals(objectCalls.length, 1);
  });

  await t.step("lets application routes shadow the gateway", async () => {
    const federation = createTestFederation();
    const objectCalls: Record<string, string>[] = [];
    let mediaCalled = false;
    federation.setObjectDispatcher(
      Note,
      "/.well-known/apgateway/{+id}",
      (_ctx, values) => {
        objectCalls.push(values);
        return null;
      },
    );
    federation.setHashlinkMediaDispatcher(() => {
      mediaCalled = true;
      return new Response(mediaBytes);
    });
    const response = await federation.fetch(
      new Request(mediaUrl(`hl:${mediaDigest}`), {
        headers: { Accept: "application/activity+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 404);
    assertEquals(objectCalls, [{ id: `hl:${mediaDigest}` }]);
    assertFalse(mediaCalled);
  });

  await t.step("keeps unrelated paths not found", async () => {
    const federation = createTestFederation();
    let mediaCalled = false;
    federation.setHashlinkMediaDispatcher(() => {
      mediaCalled = true;
      return new Response(mediaBytes);
    });
    for (
      const url of [
        `https://example.com/hl:${mediaDigest}`,
        "https://example.com/.well-known/apgateway",
        `https://example.com/.well-known/apgateway-media/hl:${mediaDigest}`,
      ]
    ) {
      const response = await federation.fetch(new Request(url), {
        contextData: undefined,
      });
      assertEquals(response.status, 404, url);
    }
    assertFalse(mediaCalled);
  });
});

test("FederationBuilder.setHashlinkMediaDispatcher()", async () => {
  const builder = createFederationBuilder<void>();
  builder.setHashlinkMediaDispatcher(() => new Response(mediaBytes));
  assertThrows(
    () => builder.setHashlinkMediaDispatcher(() => null),
    RouterError,
    "Hashlink media dispatcher already set.",
  );
  const federation = await builder.build({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const response = await federation.fetch(
    new Request(mediaUrl(`hl:${mediaDigest}`)),
    { contextData: undefined },
  );
  assertEquals(response.status, 200);
  assertEquals(new Uint8Array(await response.arrayBuffer()), mediaBytes);
});
