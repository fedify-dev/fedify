import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Collection,
  Create,
  Note,
  Object,
  Person,
  Tombstone,
} from "@fedify/vocab";
import { exportDidKey, formatIri, parseIri } from "@fedify/vocab-runtime";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { signRequest } from "../sig/http.ts";
import { signObject, verifyPortableObjectProof } from "../sig/proof.ts";
import {
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import type { RequestContext } from "./context.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";
import { PORTABLE_OBJECT_CONTENT_TYPE } from "./portable.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const keyId = new URL(`${did}#${did.substring("did:key:".length)}`);
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);
const otherKeyId = new URL(
  `${otherDid}#${otherDid.substring("did:key:".length)}`,
);

const ACCEPT = "application/activity+json";

function gatewayUrl(path: string, authority: string = did): string {
  return `https://example.com/.well-known/apgateway/${authority}${path}`;
}

function gatewayRequest(
  path: string,
  init: RequestInit & { authority?: string } = {},
): Request {
  const { authority, ...rest } = init;
  return new Request(gatewayUrl(path, authority), {
    ...rest,
    headers: { Accept: ACCEPT, ...rest.headers },
  });
}

function createTestFederation() {
  return createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
}

async function sign<T extends Object>(
  object: T,
  privateKey: CryptoKey = ed25519PrivateKey,
  key: URL = keyId,
): Promise<T> {
  return await signObject(object, privateKey, key, {
    contextLoader: mockDocumentLoader,
  });
}

async function signedNote(
  path: string,
  authority: string = did,
  content = "Hello",
): Promise<Note> {
  return await sign(
    new Note({
      id: parseIri(`ap+ef61://${authority}${path}`),
      attribution: parseIri(`ap+ef61://${authority}/actor`),
      content,
    }),
  );
}

test("Federation.fetch() serves portable objects through object dispatchers", async (t) => {
  const federation = createTestFederation();
  const calls: {
    values: Record<string, string>;
    portableRequest: RequestContext<void>["portableRequest"];
  }[] = [];
  federation.setObjectDispatcher(
    Note,
    "/users/{userId}/notes/{noteId}",
    async (ctx, values) => {
      calls.push({ values, portableRequest: ctx.portableRequest });
      if (values.noteId === "missing") return null;
      if (values.noteId === "https") {
        return new Note({
          id: ctx.getObjectUri(Note, values),
          content: "Not portable",
        });
      }
      if (values.noteId === "ap") {
        return await sign(
          new Note({
            id: parseIri(`ap://${did}/users/${values.userId}/notes/ap`),
            content: "Hello",
          }),
        );
      }
      // Pretends that this server stores objects only for `did`, but ignores
      // the requested authority, as a buggy dispatcher would:
      if (values.noteId === "ignores-authority") {
        return await signedNote(
          `/users/${values.userId}/notes/${values.noteId}`,
        );
      }
      if (ctx.portableRequest?.authority !== did) return null;
      return await sign(
        new Note({
          id: ctx.getPortableObjectUri(Note, values),
          attribution: parseIri(`ap+ef61://${did}/actor`),
          content: `Note ${values.noteId} by ${values.userId}`,
        }),
      );
    },
  );
  federation.setActorDispatcher(
    "/actors/{identifier}",
    (ctx, identifier) => new Person({ id: ctx.getActorUri(identifier) }),
  );

  await t.step("serves a portable object", async () => {
    calls.length = 0;
    const response = await federation.fetch(
      gatewayRequest("/users/alice/notes/123"),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Content-Type"),
      PORTABLE_OBJECT_CONTENT_TYPE,
    );
    assertEquals(response.headers.get("Vary"), "Accept");
    const json = await response.json() as Record<string, unknown>;
    assertEquals(json.id, `ap+ef61://${did}/users/alice/notes/123`);
    assertEquals(json.content, "Note 123 by alice");
    const verified = await verifyPortableObjectProof(json, {
      contextLoader: mockDocumentLoader,
    });
    assertEquals(verified.verified, true);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].values, { userId: "alice", noteId: "123" });
    assertEquals(calls[0].portableRequest?.authority, did);
    assertEquals(
      formatIri(calls[0].portableRequest!.id),
      `ap+ef61://${did}/users/alice/notes/123`,
    );
  });

  await t.step("accepts a percent-encoded DID authority", async () => {
    calls.length = 0;
    const response = await federation.fetch(
      gatewayRequest("/users/alice/notes/123", {
        authority: did.replaceAll(":", "%3A"),
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(calls[0].portableRequest?.authority, did);
  });

  await t.step("ignores the query, including location hints", async () => {
    const response = await federation.fetch(
      gatewayRequest(
        "/users/alice/notes/123?@gateway=https%3A%2F%2Fexample.com&x=%ZZ",
      ),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
  });

  await t.step("accepts an ap: ID returned by the dispatcher", async () => {
    const response = await federation.fetch(
      gatewayRequest("/users/alice/notes/ap"),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
  });

  await t.step("responds to HEAD without a body", async () => {
    const response = await federation.fetch(
      gatewayRequest("/users/alice/notes/123", { method: "HEAD" }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Content-Type"),
      PORTABLE_OBJECT_CONTENT_TYPE,
    );
    assertEquals(response.body, null);
  });

  await t.step("responds with 404 for objects it does not serve", async () => {
    for (
      const request of [
        // The dispatcher returns null:
        gatewayRequest("/users/alice/notes/missing"),
        // The dispatcher returns an object with an HTTPS ID:
        gatewayRequest("/users/alice/notes/https"),
        // The dispatcher does not host objects for the other DID:
        gatewayRequest("/users/alice/notes/123", { authority: otherDid }),
        // The dispatcher returns an object of another DID:
        gatewayRequest("/users/alice/notes/ignores-authority", {
          authority: otherDid,
        }),
        // No object dispatcher matches:
        gatewayRequest("/users/alice/posts/123"),
        // Actor routes are not served through the gateway:
        gatewayRequest("/actors/alice"),
      ]
    ) {
      const response = await federation.fetch(request, {
        contextData: undefined,
      });
      assertEquals(response.status, 404, request.url);
    }
  });

  await t.step("responds with 400 for malformed portable IDs", async () => {
    for (
      const path of [
        `/.well-known/apgateway/${did}`,
        "/.well-known/apgateway/did:key:/users/alice/notes/123",
        `/.well-known/apgateway/${did}/users/alice/notes/%ZZ`,
      ]
    ) {
      const response = await federation.fetch(
        new Request(`https://example.com${path}`, {
          headers: { Accept: ACCEPT },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 400, path);
    }
  });

  await t.step("leaves other gateway requests to onNotFound()", async () => {
    for (
      const request of [
        new Request("https://example.com/.well-known/apgateway", {
          headers: { Accept: ACCEPT },
        }),
        new Request(
          "https://example.com/.well-known/apgateway/hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n",
        ),
        gatewayRequest("/users/alice/notes/123", {
          method: "POST",
          body: "{}",
        }),
      ]
    ) {
      let notFound = false;
      const response = await federation.fetch(request, {
        contextData: undefined,
        onNotFound() {
          notFound = true;
          return new Response("Not found", { status: 404 });
        },
      });
      assertEquals(response.status, 404);
      assertEquals(notFound, true, request.url);
    }
  });

  await t.step("responds to HEAD without a body on errors", async () => {
    for (
      const [request, status] of [
        [gatewayRequest("/users/alice/notes/missing", { method: "HEAD" }), 404],
        [
          gatewayRequest("/users/alice/notes/123", {
            method: "HEAD",
            headers: { Accept: "text/html" },
          }),
          406,
        ],
      ] as const
    ) {
      const response = await federation.fetch(request, {
        contextData: undefined,
      });
      assertEquals(response.status, status);
      assertEquals(response.body, null);
    }
  });

  await t.step(
    "responds with 406 without a JSON-LD Accept header",
    async () => {
      const response = await federation.fetch(
        gatewayRequest("/users/alice/notes/123", {
          headers: { Accept: "text/html" },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 406);
    },
  );

  await t.step("keeps ordinary object requests unchanged", async () => {
    const response = await federation.fetch(
      new Request("https://example.com/users/alice/notes/https", {
        headers: { Accept: ACCEPT },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Content-Type"),
      "application/activity+json",
    );
    assertEquals(
      ((await response.json()) as { id: string }).id,
      "https://example.com/users/alice/notes/https",
    );
  });
});

test("Federation.fetch() applies the FEP-ef61 proof policy to portable objects", async (t) => {
  const federation = createTestFederation();
  const objects: Record<string, () => Promise<Object>> = {
    "valid": () => signedNote("/objects/valid"),
    "unsigned": () =>
      Promise.resolve(
        new Note({ id: parseIri(`ap+ef61://${did}/objects/unsigned`) }),
      ),
    "wrong-did": () =>
      sign(
        new Note({ id: parseIri(`ap+ef61://${did}/objects/wrong-did`) }),
        otherKeyPair.privateKey,
        otherKeyId,
      ),
    "tampered": async () =>
      (await signedNote("/objects/tampered")).clone({ content: "Tampered" }),
    "unsigned-collection": () =>
      Promise.resolve(
        new Collection({
          id: parseIri(`ap+ef61://${did}/objects/unsigned-collection`),
          totalItems: 0,
        }),
      ),
    "aliased-collection": () =>
      // Keeps the original JSON-LD document, which aliases @id differently:
      Collection.fromJsonLd(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            { "identifier": "@id" },
          ],
          type: "Collection",
          identifier: `ap+ef61://${did}/objects/aliased-collection`,
          totalItems: 0,
        },
        {
          contextLoader: mockDocumentLoader,
          documentLoader: mockDocumentLoader,
        },
      ),
    "tampered-collection": async () =>
      (await sign(
        new Collection({
          id: parseIri(`ap+ef61://${did}/objects/tampered-collection`),
          totalItems: 0,
        }),
      )).clone({ totalItems: 1 }),
    "activity": () =>
      sign(
        new Create({
          id: parseIri(`ap+ef61://${did}/objects/activity`),
          actor: parseIri(`ap+ef61://${did}/actor`),
          object: parseIri(`ap+ef61://${did}/objects/valid`),
        }),
      ),
    "actor": () =>
      sign(
        new Person({
          id: parseIri(`ap+ef61://${did}/objects/actor`),
          inbox: parseIri(`ap+ef61://${did}/objects/actor/inbox`),
          outbox: parseIri(`ap+ef61://${did}/objects/actor/outbox`),
          gateways: [new URL("https://example.com/")],
        }),
      ),
    "mutated-id": async () => {
      // An object that keeps its signed JSON-LD, but whose id is changed
      // afterwards, must not be served as the object in the changed id:
      const signed = await signedNote("/objects/original");
      const object = await Note.fromJsonLd(
        await signed.toJsonLd({ contextLoader: mockDocumentLoader }),
        {
          contextLoader: mockDocumentLoader,
          documentLoader: mockDocumentLoader,
        },
      );
      object.id!.pathname = "/objects/mutated-id";
      return object;
    },
    "unsigned-actor": () =>
      Promise.resolve(
        new Person({
          id: parseIri(`ap+ef61://${did}/objects/unsigned-actor`),
          inbox: parseIri(`ap+ef61://${did}/objects/unsigned-actor/inbox`),
          outbox: parseIri(`ap+ef61://${did}/objects/unsigned-actor/outbox`),
          gateways: [new URL("https://example.com/")],
        }),
      ),
  };
  federation.setObjectDispatcher(
    Object,
    "/objects/{id}",
    (_ctx, { id }) => objects[id]?.() ?? null,
  );
  const expected: Record<string, number> = {
    "valid": 200,
    "unsigned": 500,
    "wrong-did": 500,
    "tampered": 500,
    "unsigned-collection": 200,
    "aliased-collection": 200,
    "tampered-collection": 500,
    "activity": 200,
    "actor": 200,
    "mutated-id": 404,
    "unsigned-actor": 500,
  };
  for (const [id, status] of globalThis.Object.entries(expected)) {
    await t.step(`${id} → ${status}`, async () => {
      const response = await federation.fetch(
        gatewayRequest(`/objects/${id}`),
        { contextData: undefined },
      );
      assertEquals(response.status, status);
      if (status === 500) {
        assertEquals(await response.text(), "Internal server error.");
      }
    });
  }

  await t.step("responds to HEAD without a body on failure", async () => {
    const response = await federation.fetch(
      gatewayRequest("/objects/unsigned", { method: "HEAD" }),
      { contextData: undefined },
    );
    assertEquals(response.status, 500);
    assertEquals(response.body, null);
  });
});

test("Federation.fetch() authorizes portable object requests", async (t) => {
  const federation = createTestFederation();
  let dispatched = 0;
  federation
    .setObjectDispatcher(Note, "/notes/{id}", (ctx, values) => {
      dispatched++;
      // Unsigned, so a request that passes the authorization would fail with
      // 500, not 401:
      if (values.id === "unsigned") {
        return new Note({ id: ctx.getPortableObjectUri(Note, values) });
      }
      return signedNote(`/notes/${values.id}`);
    })
    .authorize(async (ctx) => {
      assertEquals(ctx.portableRequest?.authority, did);
      const owner = await ctx.getSignedKeyOwner();
      return owner?.id?.href === "https://example.com/person2";
    });

  await t.step("allows a signed request by the audience", async () => {
    const request = await signRequest(
      gatewayRequest("/notes/1"),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    const response = await federation.fetch(request, {
      contextData: undefined,
    });
    assertEquals(response.status, 200);
  });

  await t.step("denies an unsigned request", async () => {
    const response = await federation.fetch(gatewayRequest("/notes/1"), {
      contextData: undefined,
    });
    assertEquals(response.status, 401);
  });

  await t.step("denies a request signed by someone else", async () => {
    const request = await signRequest(
      gatewayRequest("/notes/1"),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
    );
    const response = await federation.fetch(request, {
      contextData: undefined,
    });
    assertEquals(response.status, 401);
  });

  await t.step("denies a request whose target was tampered with", async () => {
    const signed = await signRequest(
      gatewayRequest("/notes/1"),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    const response = await federation.fetch(
      new Request(gatewayUrl("/notes/2"), { headers: signed.headers }),
      { contextData: undefined },
    );
    assertEquals(response.status, 401);
  });

  await t.step("authorizes before checking proofs", async () => {
    dispatched = 0;
    const response = await federation.fetch(gatewayRequest("/notes/unsigned"), {
      contextData: undefined,
    });
    assertEquals(response.status, 401);
    assertEquals(dispatched, 1);
  });
});

test("Federation.fetch() lets application routes shadow the gateway", async () => {
  const federation = createTestFederation();
  const paths: string[] = [];
  federation.setObjectDispatcher(Note, "/{+path}", (_ctx, { path }) => {
    paths.push(path);
    return null;
  });
  const response = await federation.fetch(gatewayRequest("/notes/1"), {
    contextData: undefined,
  });
  assertEquals(response.status, 404);
  assertEquals(paths, [`.well-known/apgateway/${did}/notes/1`]);
});

test("Federation.fetch() compares portable IDs with the requested path", async () => {
  const federation = createTestFederation();
  federation.setObjectDispatcher(Note, "/notes/{id}", async (ctx, values) => {
    if (values.id === "a/b") {
      return await sign(
        new Note({ id: ctx.getPortableObjectUri(Note, values) }),
      );
    }
    return await signedNote(`/notes/${values.id}`);
  });
  let response = await federation.fetch(gatewayRequest("/notes/a%2Fb"), {
    contextData: undefined,
  });
  assertEquals(response.status, 200);
  assertEquals(
    ((await response.json()) as { id: string }).id,
    `ap+ef61://${did}/notes/a%2Fb`,
  );

  const tolerant = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
    trailingSlashInsensitive: true,
  });
  tolerant.setObjectDispatcher(
    Note,
    "/notes/{id}",
    (_ctx, values) => signedNote(`/notes/${values.id}`),
  );
  response = await tolerant.fetch(gatewayRequest("/notes/1/"), {
    contextData: undefined,
  });
  // The route matches, but the object is not the one requested:
  assertEquals(response.status, 404);
});

test("RequestContext.portableRequest", async (t) => {
  const federation = createTestFederation();
  const contexts: RequestContext<void>[] = [];
  federation.setObjectDispatcher(Tombstone, "/tombstones/{id}", (ctx) => {
    contexts.push(ctx);
    return null;
  });
  federation.setObjectDispatcher(Note, "/notes/{id}", async (ctx, values) => {
    contexts.push(ctx);
    // Mutating the returned URL must not change the requested ID:
    ctx.portableRequest!.id.pathname = "/notes/other";
    await ctx.getObject(Tombstone, { id: values.id });
    contexts.push(ctx.clone(undefined));
    return await sign(new Note({ id: ctx.getPortableObjectUri(Note, values) }));
  });
  const response = await federation.fetch(gatewayRequest("/notes/1"), {
    contextData: undefined,
  });
  assertEquals(response.status, 200);

  await t.step("is frozen and returns a new URL each time", () => {
    const [ctx] = contexts;
    const portableRequest = ctx.portableRequest!;
    assertEquals(globalThis.Object.isFrozen(portableRequest), true);
    assertEquals(formatIri(portableRequest.id), `ap+ef61://${did}/notes/1`);
    assertInstanceOf(portableRequest.id, URL);
    const first = portableRequest.id;
    const second = portableRequest.id;
    assertEquals(first === second, false);
  });

  await t.step("is kept by derived contexts", () => {
    assertEquals(contexts.length, 3);
    assertStrictEquals(
      contexts[1].portableRequest,
      contexts[0].portableRequest,
    );
    assertStrictEquals(
      contexts[2].portableRequest,
      contexts[0].portableRequest,
    );
  });

  await t.step("is undefined for ordinary requests", () => {
    const ctx = federation.createContext(
      new Request("https://example.com/notes/1"),
      undefined,
    );
    assertEquals(ctx.portableRequest, undefined);
  });
});

test("Context.getPortableObjectUri()", async (t) => {
  const federation = createTestFederation();
  federation.setObjectDispatcher(
    Note,
    "/users/{userId}/notes/{noteId}",
    () => null,
  );
  const ctx = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );
  const values = { userId: "alice", noteId: "123" };

  await t.step("builds a portable ID from the object path", () => {
    const uri = ctx.getPortableObjectUri(Note, values, did);
    assertInstanceOf(uri, URL);
    assertEquals(uri.protocol, "ap+ef61:");
    assertEquals(formatIri(uri), `ap+ef61://${did}/users/alice/notes/123`);
    assertEquals(
      ctx.getObjectUri(Note, values),
      new URL("https://example.com/users/alice/notes/123"),
    );
  });

  await t.step("requires a bare DID authority", () => {
    for (
      const authority of [
        `${did}/extra`,
        `${did}?query`,
        `${did}#fragment`,
        "did:key:",
        "https://example.com",
        "",
      ]
    ) {
      assertThrows(
        () => ctx.getPortableObjectUri(Note, values, authority),
        TypeError,
        undefined,
        authority,
      );
    }
  });

  await t.step("requires an authority outside gateway requests", () => {
    const requestCtx = federation.createContext(
      new Request("https://example.com/"),
      undefined,
    );
    assertThrows(
      () => requestCtx.getPortableObjectUri(Note, values),
      TypeError,
    );
    assertEquals(
      formatIri(requestCtx.getPortableObjectUri(Note, values, did)),
      `ap+ef61://${did}/users/alice/notes/123`,
    );
  });

  await t.step("validates values like getObjectUri()", () => {
    assertThrows(
      () => ctx.getPortableObjectUri(Note, { userId: "alice" }, did),
      TypeError,
    );
    assertThrows(() => ctx.getPortableObjectUri(Person, values, did));
  });
});
