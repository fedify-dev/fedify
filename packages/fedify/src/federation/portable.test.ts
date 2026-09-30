import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Collection,
  Create,
  lookupObject,
  Note,
  Object,
  Person,
  PUBLIC_COLLECTION,
  Tombstone,
} from "@fedify/vocab";
import {
  exportDidKey,
  formatIri,
  parseIri,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import type { ResourceDescriptor } from "@fedify/webfinger";
import { configure, type LogRecord, reset } from "@logtape/logtape";
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
import type { Context, RequestContext } from "./context.ts";
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
      to: PUBLIC_COLLECTION,
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
            to: PUBLIC_COLLECTION,
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
          to: PUBLIC_COLLECTION,
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
        // The actor dispatcher returns an actor with an HTTPS ID:
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
    "actor-without-gateways": () =>
      sign(
        new Person({
          id: parseIri(`ap+ef61://${did}/objects/actor-without-gateways`),
          inbox: parseIri(
            `ap+ef61://${did}/objects/actor-without-gateways/inbox`,
          ),
          outbox: parseIri(
            `ap+ef61://${did}/objects/actor-without-gateways/outbox`,
          ),
        }),
      ),
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
  federation
    .setObjectDispatcher(
      Object,
      "/objects/{id}",
      (_ctx, { id }) => objects[id]?.() ?? null,
    )
    // Serves the objects regardless of their audience, as this test is about
    // the proof policy:
    .authorize(() => true);
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
    "actor-without-gateways": 500,
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

test("Federation.fetch() serves tombstones of portable objects", async (t) => {
  const federation = createTestFederation();
  const compatible = (path: string) =>
    new URL(`https://example.com/.well-known/apgateway/${did}${path}`);
  const tombstoneFromJsonLd = (
    path: string,
    properties: Record<string, unknown>,
  ) =>
    // Keeps the extra properties, which make it look like another FEP-2277
    // core type than an object:
    Tombstone.fromJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Tombstone",
        id: `ap+ef61://${did}${path}`,
        ...properties,
      },
      {
        contextLoader: mockDocumentLoader,
        documentLoader: mockDocumentLoader,
      },
    );
  const tombstones: Record<string, () => Promise<Tombstone>> = {
    "signed": () =>
      sign(
        new Tombstone({
          id: parseIri(`ap+ef61://${did}/notes/signed`),
          formerType: Note,
          deleted: Temporal.Instant.from("2026-01-01T00:00:00Z"),
        }),
      ),
    "compatible": () =>
      sign(
        new Tombstone({
          id: compatible("/notes/compatible"),
          formerType: Note,
        }),
      ),
    // A collection-shaped tombstone is still verified if it has a proof:
    "signed-collection": async () =>
      sign(
        await tombstoneFromJsonLd("/notes/signed-collection", {
          totalItems: 0,
        }),
      ),
    "unsigned": () =>
      Promise.resolve(
        new Tombstone({
          id: parseIri(`ap+ef61://${did}/notes/unsigned`),
          formerType: Note,
        }),
      ),
    "wrong-did": () =>
      sign(
        new Tombstone({ id: parseIri(`ap+ef61://${did}/notes/wrong-did`) }),
        otherKeyPair.privateKey,
        otherKeyId,
      ),
    "tampered": async () =>
      (await sign(
        new Tombstone({ id: parseIri(`ap+ef61://${did}/notes/tampered`) }),
      )).clone({ formerType: Note }),
    // The exemption of unsecured collections does not apply to tombstones:
    "unsigned-collection": () =>
      tombstoneFromJsonLd("/notes/unsigned-collection", { totalItems: 0 }),
    // Nor does the exemption of links:
    "link": () =>
      tombstoneFromJsonLd("/notes/link", { href: "https://example.com/" }),
    "mismatched": () =>
      sign(new Tombstone({ id: parseIri(`ap+ef61://${did}/notes/other`) })),
    "mutated-id": async () => {
      // A tombstone that keeps its signed JSON-LD, but whose id is changed
      // afterwards, must not be served as the tombstone in the changed id:
      const signed = await sign(
        new Tombstone({ id: parseIri(`ap+ef61://${did}/notes/original`) }),
      );
      const tombstone = await Tombstone.fromJsonLd(
        await signed.toJsonLd({ contextLoader: mockDocumentLoader }),
        {
          contextLoader: mockDocumentLoader,
          documentLoader: mockDocumentLoader,
        },
      );
      tombstone.id!.pathname = tombstone.id!.pathname.replace(
        /original$/,
        "mutated-id",
      );
      return tombstone;
    },
  };
  federation
    .setObjectDispatcher(
      Note,
      "/notes/{id}",
      (_ctx, { id }) => tombstones[id]?.() ?? null,
    )
    .authorize((ctx) => ctx.request.headers.get("X-Deny") == null);

  // Makes sure that each failing fixture fails for the intended reason:
  const reasons: Record<string, string> = {
    "unsigned": "missingProof",
    "wrong-did": "verificationMethodMismatch",
    "tampered": "invalidProof",
    "unsigned-collection": "unsecuredCollection",
    "link": "unsupportedObjectType",
  };
  for (const [id, reason] of globalThis.Object.entries(reasons)) {
    const tombstone = await tombstones[id]();
    const result = await verifyPortableObjectProof(
      await tombstone.toJsonLd({ contextLoader: mockDocumentLoader }),
      { contextLoader: mockDocumentLoader },
    );
    assert(!result.verified, id);
    assertEquals(result.reason.type, reason, id);
  }

  const expected: Record<string, number> = {
    "signed": 410,
    "compatible": 410,
    "signed-collection": 410,
    "unsigned": 404,
    "wrong-did": 500,
    "tampered": 500,
    "unsigned-collection": 500,
    "link": 500,
    "mismatched": 404,
    "mutated-id": 404,
  };
  for (const [id, status] of globalThis.Object.entries(expected)) {
    await t.step(`${id} → ${status}`, async () => {
      let notFound = false;
      const response = await federation.fetch(gatewayRequest(`/notes/${id}`), {
        contextData: undefined,
        onNotFound() {
          notFound = true;
          return new Response("Not found", { status: 404 });
        },
      });
      assertEquals(response.status, status);
      assertEquals(notFound, status === 404);
      if (status === 410) {
        assertEquals(
          response.headers.get("Content-Type"),
          PORTABLE_OBJECT_CONTENT_TYPE,
        );
        assertEquals(response.headers.get("Vary"), "Accept");
        const body = await response.json() as Record<string, unknown>;
        assertEquals(body.type, "Tombstone");
        const verified = await verifyPortableObjectProof(body, {
          contextLoader: mockDocumentLoader,
        });
        assert(verified.verified);
      } else if (status === 500) {
        assertEquals(await response.text(), "Internal server error.");
      }
    });
  }

  await t.step(
    "serves the tombstone as the dispatcher returns it",
    async () => {
      let response = await federation.fetch(gatewayRequest("/notes/signed"), {
        contextData: undefined,
      });
      let body = await response.json() as Record<string, unknown>;
      assertEquals(body.id, `ap+ef61://${did}/notes/signed`);
      assertEquals(body.formerType, "as:Note");
      assertEquals(body.deleted, "2026-01-01T00:00:00Z");
      // A compatible identifier is not rewritten to the portable ID:
      response = await federation.fetch(gatewayRequest("/notes/compatible"), {
        contextData: undefined,
      });
      body = await response.json() as Record<string, unknown>;
      assertEquals(body.id, compatible("/notes/compatible").href);
    },
  );

  await t.step("responds to HEAD without a body", async () => {
    for (const [id, status] of [["signed", 410], ["unsigned", 404]] as const) {
      const response = await federation.fetch(
        gatewayRequest(`/notes/${id}`, { method: "HEAD" }),
        { contextData: undefined },
      );
      assertEquals(response.status, status, id);
      assertEquals(response.body, null, id);
      if (status === 410) {
        assertEquals(
          response.headers.get("Content-Type"),
          PORTABLE_OBJECT_CONTENT_TYPE,
        );
        assertEquals(response.headers.get("Vary"), "Accept");
      }
    }
  });

  await t.step("authorizes before serving a tombstone", async () => {
    for (const id of ["signed", "unsigned"]) {
      let unauthorized = false;
      const response = await federation.fetch(
        gatewayRequest(`/notes/${id}`, { headers: { "X-Deny": "1" } }),
        {
          contextData: undefined,
          onUnauthorized() {
            unauthorized = true;
            return new Response("Unauthorized", { status: 401 });
          },
        },
      );
      assertEquals(response.status, 401, id);
      assertEquals(unauthorized, true, id);
    }
  });

  await t.step(
    "does not warn about tombstones with compatible IDs",
    async () => {
      const records = await captureWarnings(async () => {
        const response = await federation.fetch(
          gatewayRequest("/notes/compatible"),
          { contextData: undefined },
        );
        assertEquals(response.status, 410);
      });
      assertEquals(
        records.filter((record) => record.category[2] === "object"),
        [],
      );
    },
  );
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

test("Federation.fetch() serves only public portable objects by default", async (t) => {
  const federation = createTestFederation();
  const person2 = new URL("https://example.com/person2");
  const note = (id: string, values: Record<string, unknown> = {}) =>
    sign(
      new Note({ id: parseIri(`ap+ef61://${did}/objects/${id}`), ...values }),
    );
  const objects: Record<string, () => Promise<Object>> = {
    "to": () => note("to", { to: PUBLIC_COLLECTION }),
    "cc": () => note("cc", { to: person2, cc: PUBLIC_COLLECTION }),
    "bto": () => note("bto", { bto: PUBLIC_COLLECTION }),
    "bcc": () => note("bcc", { bcc: PUBLIC_COLLECTION }),
    "audience": () => note("audience", { audience: PUBLIC_COLLECTION }),
    "unaddressed": () => note("unaddressed"),
    "direct": () => note("direct", { to: person2 }),
    "followers": () =>
      note("followers", { cc: new URL("https://example.com/followers") }),
    // Signed by another DID, so it would be refused with 500 if its proof
    // were verified:
    "wrong-did": () =>
      sign(
        new Note({
          id: parseIri(`ap+ef61://${did}/objects/wrong-did`),
          to: person2,
        }),
        otherKeyPair.privateKey,
        otherKeyId,
      ),
    "public-create-of-private-note": async () =>
      await sign(
        new Create({
          id: parseIri(
            `ap+ef61://${did}/objects/public-create-of-private-note`,
          ),
          actor: parseIri(`ap+ef61://${did}/actor`),
          to: PUBLIC_COLLECTION,
          object: await note("private-note", { to: person2 }),
        }),
      ),
    "private-create-of-public-note": async () =>
      await sign(
        new Create({
          id: parseIri(
            `ap+ef61://${did}/objects/private-create-of-public-note`,
          ),
          actor: parseIri(`ap+ef61://${did}/actor`),
          object: await note("public-note", { to: PUBLIC_COLLECTION }),
        }),
      ),
    // Collections and tombstones from object dispatchers are not exempt:
    "collection": () =>
      Promise.resolve(
        new Collection({
          id: parseIri(`ap+ef61://${did}/objects/collection`),
          totalItems: 0,
        }),
      ),
    "public-collection": () =>
      Promise.resolve(
        new Collection({
          id: parseIri(`ap+ef61://${did}/objects/public-collection`),
          to: PUBLIC_COLLECTION,
          totalItems: 0,
        }),
      ),
    "tombstone": () =>
      sign(
        new Tombstone({ id: parseIri(`ap+ef61://${did}/objects/tombstone`) }),
      ),
    "public-tombstone": () =>
      sign(
        new Tombstone({
          id: parseIri(`ap+ef61://${did}/objects/public-tombstone`),
          to: PUBLIC_COLLECTION,
        }),
      ),
    // Actors have no audience, so they are served regardless:
    "actor": () =>
      sign(
        new Person({
          id: parseIri(`ap+ef61://${did}/objects/actor`),
          inbox: parseIri(`ap+ef61://${did}/objects/actor/inbox`),
          outbox: parseIri(`ap+ef61://${did}/objects/actor/outbox`),
          gateways: [new URL("https://example.com/")],
        }),
      ),
    // The object says it is public, but the document that would be served,
    // which it keeps from fromJsonLd(), does not:
    "mutated-audience": async () => {
      const signed = await note("mutated-audience", { to: person2 });
      const object = await Note.fromJsonLd(
        await signed.toJsonLd({ contextLoader: mockDocumentLoader }),
        {
          contextLoader: mockDocumentLoader,
          documentLoader: mockDocumentLoader,
        },
      );
      object.toIds[0].href = PUBLIC_COLLECTION.href;
      return object;
    },
  };
  let dispatched = 0;
  federation.setObjectDispatcher(Object, "/objects/{id}", (ctx, { id }) => {
    dispatched++;
    // An ordinary request for a non-public object is left to the application
    // as before:
    if (ctx.portableRequest == null) {
      return new Note({ id: ctx.getObjectUri(Object, { id }), to: person2 });
    }
    return objects[id]?.() ?? null;
  });
  const expected: Record<string, number> = {
    "to": 200,
    "cc": 200,
    "bto": 200,
    "bcc": 200,
    "audience": 200,
    "unaddressed": 404,
    "direct": 404,
    "followers": 404,
    "wrong-did": 404,
    "public-create-of-private-note": 200,
    "private-create-of-public-note": 404,
    "collection": 404,
    "public-collection": 200,
    "tombstone": 404,
    "public-tombstone": 410,
    "actor": 200,
    "mutated-audience": 404,
  };
  for (const [id, status] of globalThis.Object.entries(expected)) {
    await t.step(`${id} → ${status}`, async () => {
      for (const method of ["GET", "HEAD"]) {
        dispatched = 0;
        let response: Response | undefined;
        const records = await captureWarnings(async () => {
          response = await federation.fetch(
            gatewayRequest(`/objects/${id}`, { method }),
            { contextData: undefined },
          );
        });
        assertEquals(response?.status, status, method);
        assertEquals(dispatched, 1);
        // Nothing depends on the requester without an authorization
        // predicate, so the response may be cached as usual:
        assertEquals(response?.headers.get("Cache-Control"), null);
        // A non-public object's proof is not even verified, so it is not
        // refused for its proof:
        assertEquals(
          records.filter((r) => r.level === "error").map((r) => r.rawMessage),
          [],
        );
        if (method === "HEAD") assertEquals(response?.body, null);
      }
    });
  }

  await t.step("responds to a denied request with onNotFound()", async () => {
    let notFound = false;
    const response = await federation.fetch(gatewayRequest("/objects/direct"), {
      contextData: undefined,
      onNotFound() {
        notFound = true;
        return new Response("Not found", { status: 404 });
      },
    });
    assertEquals(response.status, 404);
    assertEquals(notFound, true);
  });

  await t.step("keeps ordinary object requests unchanged", async () => {
    const response = await federation.fetch(
      new Request("https://example.com/objects/direct", {
        headers: { Accept: ACCEPT },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
  });
});

test("Federation.fetch() serves non-public portable objects to their audience", async (t) => {
  const federation = createTestFederation();
  const person2 = new URL("https://example.com/person2");
  const followers = new URL("https://example.com/users/alice/followers");
  const notes: Record<string, Promise<Note>> = {
    direct: sign(
      new Note({ id: parseIri(`ap+ef61://${did}/notes/direct`), to: person2 }),
    ),
    followers: sign(
      new Note({
        id: parseIri(`ap+ef61://${did}/notes/followers`),
        cc: followers,
      }),
    ),
    public: signedNote("/notes/public"),
    other: sign(
      new Note({
        id: parseIri(`ap+ef61://${did}/notes/other`),
        to: new URL("https://example.com/other"),
      }),
    ),
  };
  federation
    .setObjectDispatcher(
      Note,
      "/notes/{id}",
      (_ctx, values) => notes[values.id] ?? null,
    )
    .authorize(async (ctx, values) => {
      const note = await notes[values.id];
      return note != null && await ctx.isSignedByAudience(note, {
        isMember: (addressee, actor) =>
          addressee.href === followers.href &&
          actor.id?.href === person2.href,
      });
    });
  const signed = async (id: string, key: "key2" | "key3" = "key3") =>
    await signRequest(
      gatewayRequest(`/notes/${id}`),
      key === "key3" ? rsaPrivateKey3 : rsaPrivateKey2,
      key === "key3" ? rsaPublicKey3.id! : rsaPublicKey2.id!,
    );

  await t.step("serves a request signed by an addressee", async () => {
    for (const id of ["direct", "followers"]) {
      const response = await federation.fetch(await signed(id), {
        contextData: undefined,
      });
      assertEquals(response.status, 200, id);
      assertEquals(response.headers.get("Cache-Control"), "private", id);
      const json = await response.json() as Record<string, unknown>;
      assertEquals(json.id, `ap+ef61://${did}/notes/${id}`);
    }
  });

  await t.step("denies a request by anyone else", async () => {
    for (
      const request of [
        gatewayRequest("/notes/direct"),
        await signed("direct", "key2"),
        await signed("followers", "key2"),
        await signed("other"),
      ]
    ) {
      const response = await federation.fetch(request, {
        contextData: undefined,
      });
      assertEquals(response.status, 401, request.url);
    }
  });

  await t.step("serves a public object to anyone", async () => {
    const response = await federation.fetch(gatewayRequest("/notes/public"), {
      contextData: undefined,
    });
    assertEquals(response.status, 200);
    // The predicate decides, so the response still depends on the requester:
    assertEquals(response.headers.get("Cache-Control"), "private");
  });

  await t.step("serves anything if the predicate allows it", async () => {
    const permissive = createTestFederation();
    permissive
      .setObjectDispatcher(
        Note,
        "/notes/{id}",
        (_ctx, values) => notes[values.id] ?? null,
      )
      .authorize(() => true);
    const response = await permissive.fetch(gatewayRequest("/notes/direct"), {
      contextData: undefined,
    });
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Cache-Control"), "private");
  });
});

test("Federation.fetch() serves portable objects with compatible IDs", async (t) => {
  const federation = createTestFederation();
  const compatible = (path: string, authority = did, origin = "example.com") =>
    new URL(`https://${origin}/.well-known/apgateway/${authority}${path}`);
  const objects: Record<string, () => Promise<Object>> = {
    "compatible": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible("/objects/compatible"),
        }),
      ),
    // A compatible identifier on another gateway than the one requested:
    "other-gateway": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible("/objects/other-gateway", did, "other.example"),
        }),
      ),
    "percent-encoded": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible(
            "/objects/percent-encoded",
            did.replaceAll(":", "%3A"),
          ),
        }),
      ),
    "other-did": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible("/objects/other-did", otherDid),
        }),
        otherKeyPair.privateKey,
        otherKeyId,
      ),
    "other-path": () =>
      sign(
        new Note({ to: PUBLIC_COLLECTION, id: compatible("/objects/else") }),
      ),
    "fragment": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible("/objects/fragment#note"),
        }),
      ),
    // FEP-ef61 forbids location hints in compatible identifiers:
    "malformed": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: new URL(
            compatible("/objects/malformed").href +
              "?@gateway=https%3A%2F%2Fexample.com",
          ),
        }),
      ),
    "ordinary": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: new URL("https://example.com/objects/ordinary"),
        }),
      ),
    "unsigned": () =>
      Promise.resolve(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible("/objects/unsigned"),
        }),
      ),
    "wrong-did": () =>
      sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible("/objects/wrong-did"),
        }),
        otherKeyPair.privateKey,
        otherKeyId,
      ),
    "mutated-id": async () => {
      // An object that keeps its signed JSON-LD, but whose id is changed
      // afterwards, must not be served as the object in the changed id:
      const signed = await sign(
        new Note({
          to: PUBLIC_COLLECTION,
          id: compatible("/objects/original"),
        }),
      );
      const object = await Note.fromJsonLd(
        await signed.toJsonLd({ contextLoader: mockDocumentLoader }),
        {
          contextLoader: mockDocumentLoader,
          documentLoader: mockDocumentLoader,
        },
      );
      object.id!.pathname = object.id!.pathname.replace(
        /original$/,
        "mutated-id",
      );
      return object;
    },
    "actor": () =>
      sign(
        new Person({
          id: compatible("/objects/actor"),
          inbox: compatible("/objects/actor/inbox"),
          outbox: compatible("/objects/actor/outbox"),
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
    "compatible": 200,
    "other-gateway": 200,
    "percent-encoded": 200,
    "other-did": 404,
    "other-path": 404,
    "fragment": 404,
    "malformed": 404,
    "ordinary": 404,
    "unsigned": 500,
    "wrong-did": 500,
    "mutated-id": 404,
    "actor": 200,
  };
  for (const host of ["example.com", "other.example"]) {
    for (const [id, status] of globalThis.Object.entries(expected)) {
      await t.step(`${id} on ${host} → ${status}`, async () => {
        const response = await federation.fetch(
          new Request(
            `https://${host}/.well-known/apgateway/${did}/objects/${id}`,
            { headers: { Accept: ACCEPT } },
          ),
          { contextData: undefined },
        );
        assertEquals(response.status, status);
        if (status !== 200) return;
        assertEquals(
          response.headers.get("Content-Type"),
          PORTABLE_OBJECT_CONTENT_TYPE,
        );
        // The object is served as it is, with the compatible identifier
        // naming its own gateway:
        const json = await response.json() as Record<string, unknown>;
        assertEquals(json.id, (await objects[id]()).id?.href);
      });
    }
  }

  await t.step("authorizes compatible-ID objects on any gateway", async () => {
    const authorized = createTestFederation();
    authorized
      .setObjectDispatcher(
        Note,
        "/notes/{id}",
        (_ctx, values) =>
          sign(new Note({ id: compatible(`/notes/${values.id}`) })),
      )
      .authorize(async (ctx) => {
        const owner = await ctx.getSignedKeyOwner();
        return owner?.id?.href === "https://example.com/person2";
      });
    for (const host of ["example.com", "other.example"]) {
      const url = `https://${host}/.well-known/apgateway/${did}/notes/1`;
      const request = new Request(url, { headers: { Accept: ACCEPT } });
      let response = await authorized.fetch(request, {
        contextData: undefined,
      });
      assertEquals(response.status, 401, host);
      response = await authorized.fetch(
        await signRequest(
          new Request(url, { headers: { Accept: ACCEPT } }),
          rsaPrivateKey3,
          rsaPublicKey3.id!,
        ),
        { contextData: undefined },
      );
      assertEquals(response.status, 200, host);
    }
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
        new Note({
          id: ctx.getPortableObjectUri(Note, values),
          to: PUBLIC_COLLECTION,
        }),
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
    return await sign(
      new Note({
        id: ctx.getPortableObjectUri(Note, values),
        to: PUBLIC_COLLECTION,
      }),
    );
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

test("Federation.fetch() serves portable actors through WebFinger", async () => {
  const federation = createTestFederation();
  const getActor = async (
    ctx: Context<void>,
    name: string,
  ): Promise<Person | null> => {
    if (name !== "alice") return null;
    return await sign(
      new Person({
        id: ctx.getPortableObjectUri(Person, { name }, did),
        preferredUsername: name,
        gateways: [new URL("https://example.com")],
      }),
    );
  };
  federation
    .setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) => getActor(ctx, identifier),
    )
    .mapHandle((_ctx, username) => username);
  federation.setObjectDispatcher(
    Person,
    "/actors/{name}",
    (ctx, values) =>
      ctx.portableRequest?.authority === did
        ? getActor(ctx, values.name)
        : null,
  );

  const webFinger = await federation.fetch(
    new Request(
      "https://example.com/.well-known/webfinger?resource=acct:alice@example.com",
    ),
    { contextData: undefined },
  );
  assertEquals(webFinger.status, 200);
  const jrd: ResourceDescriptor = await webFinger.json();
  const compatibleId = gatewayUrl("/actors/alice");
  assertEquals(jrd.subject, "acct:alice@example.com");
  assertEquals(jrd.links?.[0], {
    rel: "self",
    href: compatibleId,
    type: "application/activity+json",
  });

  const documentLoader = async (url: string) => {
    const response = await federation.fetch(
      new Request(url, { headers: { Accept: ACCEPT } }),
      { contextData: undefined },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return {
      contextUrl: null,
      documentUrl: url,
      document: await response.json(),
    };
  };
  const actor = await lookupObject(compatibleId, {
    documentLoader,
    contextLoader: mockDocumentLoader,
    verifyPortableObject: verifyPortableObjectProof,
  });
  assertInstanceOf(actor, Person);
  assertEquals(formatIri(actor.id!), `ap+ef61://${did}/actors/alice`);
  assertEquals(actor.preferredUsername, "alice");

  // Context.lookupObject() verifies portable objects by default:
  const ctx = federation.createContext(
    new URL("https://example.com/"),
    undefined,
  );
  assertInstanceOf(
    await ctx.lookupObject(compatibleId, { documentLoader }),
    Person,
  );
  const unsigned = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `ap://${did}/actors/alice`,
    type: "Person",
  };
  assertEquals(
    await ctx.lookupObject(compatibleId, {
      documentLoader: (url) =>
        Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: unsigned,
        }),
    }),
    null,
  );
});

/**
 * Captures Fedify's warnings logged while `run` executes.
 */
async function captureWarnings(run: () => unknown): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  await reset();
  try {
    await configure({
      sinks: { buffer: (record: LogRecord) => records.push(record) },
      filters: {},
      loggers: [
        { category: ["logtape", "meta"], sinks: [] },
        { category: [], sinks: ["buffer"], lowestLevel: "warning" },
      ],
    });
    await run();
  } finally {
    await reset();
  }
  return records.filter((record) => record.category[0] === "fedify");
}

test("object responses warn about compatible IDs off the owner's first gateway", async () => {
  const federation = createTestFederation();
  const ownerId = parseIri(`ap://${did}/users/alice`);
  const gateways = [
    new URL("https://primary.example"),
    new URL("https://secondary.example"),
  ];
  const secondary = await sign(
    new Note({
      id: toCompatibleEf61Id(
        parseIri(`ap://${did}/notes/secondary`),
        gateways[1],
      ),
      attribution: ownerId,
      to: PUBLIC_COLLECTION,
      content: "Hello",
    }),
  );
  let actorCalls = 0;
  let actorLookupFails = false;
  federation.setActorDispatcher("/users/{identifier}", (_ctx, identifier) => {
    actorCalls++;
    if (actorLookupFails) throw new Error("Actor storage unavailable");
    return identifier === "alice"
      ? new Person({ id: ownerId, gateways })
      : null;
  });
  federation.setObjectDispatcher(Note, "/notes/{id}", async (_ctx, values) => {
    if (values.id === "secondary") return secondary;
    const id = values.id === "portable"
      ? parseIri(`ap://${did}/notes/portable`)
      : values.id === "ordinary"
      ? new URL("https://example.com/notes/ordinary")
      : toCompatibleEf61Id(
        parseIri(`ap://${did}/notes/${values.id}`),
        values.id === "secondary" || values.id === "retained"
          ? gateways[1]
          : gateways[0],
      );
    const note = new Note({
      id,
      attribution: ownerId,
      to: PUBLIC_COLLECTION,
      content: "Hello",
    });
    if (values.id === "retained") {
      const signed = await sign(note);
      const raw = await signed.toJsonLd({
        format: "compact",
        contextLoader: mockDocumentLoader,
      });
      const parsed = await Note.fromJsonLd(raw, {
        contextLoader: mockDocumentLoader,
        documentLoader: mockDocumentLoader,
      });
      parsed.id!.hostname = "primary.example";
      return parsed;
    }
    return note;
  });
  federation.setObjectDispatcher(
    Create,
    "/activities/{id}",
    (_ctx, values) =>
      new Create({
        id: toCompatibleEf61Id(
          parseIri(`ap://${did}/activities/${values.id}`),
          gateways[1],
        ),
        actor: ownerId,
      }),
  );
  for (
    const [id, expected] of [
      ["secondary", 1],
      ["retained", 1],
      ["primary", 0],
      ["portable", 0],
      ["ordinary", 0],
    ] as const
  ) {
    const records = await captureWarnings(async () => {
      const response = await federation.fetch(
        new Request(`https://example.com/notes/${id}`, {
          headers: { Accept: ACCEPT },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 200);
      const body = await response.json() as { id: string; type: string };
      assertEquals(body.type, "Note");
      if (id === "retained") {
        assertEquals(
          body.id,
          `https://secondary.example/.well-known/apgateway/${did}/notes/retained`,
        );
      }
    });
    assertEquals(
      records.filter((r) => r.properties.kind === "object").length,
      expected,
      id,
    );
  }
  const activityRecords = await captureWarnings(async () => {
    const response = await federation.fetch(
      new Request("https://example.com/activities/1", {
        headers: { Accept: ACCEPT },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
  });
  assertEquals(
    activityRecords.filter((r) => r.properties.kind === "activity").length,
    1,
  );
  for (const id of ["secondary", "retained"]) {
    const gatewayRecords = await captureWarnings(async () => {
      const response = await federation.fetch(
        gatewayRequest(`/notes/${id}`),
        { contextData: undefined },
      );
      assertEquals(response.status, 200);
    });
    assertEquals(
      gatewayRecords.filter((r) => r.properties.kind === "object").length,
      1,
    );
  }
  actorLookupFails = true;
  const expectedBody = await secondary.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  });
  for (
    const request of [
      new Request("https://example.com/notes/secondary", {
        headers: { Accept: ACCEPT },
      }),
      gatewayRequest("/notes/secondary"),
    ]
  ) {
    const records = await captureWarnings(async () => {
      const response = await federation.fetch(request, {
        contextData: undefined,
      });
      assertEquals(response.status, 200);
      assertEquals(await response.json(), expectedBody);
    });
    assertEquals(records.filter((r) => r.properties.kind != null), []);
  }
  assertEquals(actorCalls, 8);
});

test("Federation.fetch() serves compatible-ID actors", async (t) => {
  const federation = createTestFederation();
  const actorGateways: Record<string, string[]> = {
    alice: ["https://example.com"],
    // The compatible identifier is not on the first gateway:
    secondary: ["https://primary.example", "https://example.com"],
    nogateway: [],
    malformed: ["https://example.com"],
  };
  const getActor = async (
    ctx: Context<void>,
    name: string,
  ): Promise<Person | null> => {
    const gateways = actorGateways[name];
    if (gateways == null) return null;
    // Compatible identifiers are built before signing, never by rewriting
    // signed documents:
    const id = toCompatibleEf61Id(
      ctx.getPortableObjectUri(Person, { name }, did),
      "https://example.com",
    );
    // FEP-ef61 forbids location hints in compatible identifiers:
    if (name === "malformed") id.search = "?@gateway=https%3A%2F%2Fexample.com";
    return await sign(
      new Person({
        id,
        preferredUsername: name,
        inbox: new URL(`${id.href}/inbox`),
        followers: toCompatibleEf61Id(
          ctx.getPortableFollowersUri(name, did),
          "https://example.com",
        ),
        gateways: gateways.map((g) => new URL(g)),
      }),
    );
  };
  federation
    .setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) => getActor(ctx, identifier),
    )
    .mapHandle((_ctx, username) => username)
    .mapAlias((_ctx, resource) => {
      // Maps compatible identifiers of the actors back to their identifiers:
      const match = resource.href.match(/\/actors\/([^/?#]+)$/);
      return match == null || !resource.href.startsWith(gatewayUrl("/"))
        ? null
        : { identifier: match[1] };
    });
  federation.setFollowersDispatcher(
    "/users/{identifier}/followers",
    () => ({ items: [] }),
  );
  federation.setObjectDispatcher(
    Person,
    "/actors/{name}",
    (ctx, values) =>
      ctx.portableRequest?.authority === did
        ? getActor(ctx, values.name)
        : null,
  );
  const compatibleId = gatewayUrl("/actors/alice");

  await t.step("WebFinger", async () => {
    let records: LogRecord[] = [];
    records = await captureWarnings(async () => {
      for (const resource of ["acct:alice@example.com", compatibleId]) {
        const response = await federation.fetch(
          new Request(
            `https://example.com/.well-known/webfinger?resource=${
              encodeURIComponent(resource)
            }`,
          ),
          { contextData: undefined },
        );
        assertEquals(response.status, 200, resource);
        const jrd: ResourceDescriptor = await response.json();
        assertEquals(jrd.subject, "acct:alice@example.com", resource);
        assertEquals(jrd.links?.[0], {
          rel: "self",
          href: compatibleId,
          type: "application/activity+json",
        });
      }
    });
    // The actor's IDs are not compared with the ones Context builds:
    assertEquals(records.map((r) => r.rawMessage), []);
  });

  await t.step("gateway", async () => {
    const response = await federation.fetch(
      new Request(compatibleId, { headers: { Accept: ACCEPT } }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    const json = await response.json() as Record<string, unknown>;
    assertEquals(json.id, compatibleId);
    const actor = await lookupObject(compatibleId, {
      documentLoader: (url) =>
        Promise.resolve({ contextUrl: null, documentUrl: url, document: json }),
      contextLoader: mockDocumentLoader,
      verifyPortableObject: verifyPortableObjectProof,
    });
    assertInstanceOf(actor, Person);
    assertEquals(actor.id?.href, compatibleId);
  });

  await t.step("warns if the ID is not on the first gateway", async () => {
    const records = await captureWarnings(async () => {
      const response = await federation.fetch(
        new Request(
          "https://example.com/.well-known/webfinger?resource=acct:secondary@example.com",
        ),
        { contextData: undefined },
      );
      assertEquals(response.status, 200);
      const jrd: ResourceDescriptor = await response.json();
      assertEquals(jrd.subject, "acct:secondary@primary.example");
      assertEquals(jrd.links?.[0].href, gatewayUrl("/actors/secondary"));
    });
    assertEquals(
      records.map((r) => r.properties.gateway),
      ["https://primary.example"],
    );
  });

  await t.step("warns if the actor has no gateways", async () => {
    const records = await captureWarnings(async () => {
      const response = await federation.fetch(
        new Request("https://example.com/users/nogateway", {
          headers: { Accept: ACCEPT },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 200);
    });
    assertEquals(
      records.map((r) => r.properties.actorId),
      [gatewayUrl("/actors/nogateway")],
    );
    assert(String(records[0].rawMessage).includes("gateways property"));
  });

  await t.step(
    "warns if the ID is a malformed compatible identifier",
    async () => {
      const records = await captureWarnings(async () => {
        const response = await federation.fetch(
          new Request("https://example.com/users/malformed", {
            headers: { Accept: ACCEPT },
          }),
          { contextData: undefined },
        );
        assertEquals(response.status, 200);
      });
      assertEquals(records.length, 1);
      assert(String(records[0].rawMessage).includes("malformed"));
    },
  );
});

test("Federation.fetch() warns about portable actors without valid gateways", async (t) => {
  const federation = createTestFederation();
  const actors: Record<string, (ctx: Context<void>) => Person | Tombstone> = {
    valid: (ctx) =>
      new Person({
        id: ctx.getPortableObjectUri(Person, { name: "valid" }, did),
        gateways: [
          new URL("https://example.com"),
          new URL("https://other.example/"),
        ],
      }),
    empty: (ctx) =>
      new Person({
        id: ctx.getPortableObjectUri(Person, { name: "empty" }, did),
      }),
    mutated: (ctx) => {
      const actor = new Person({
        id: ctx.getPortableObjectUri(Person, { name: "mutated" }, did),
        gateways: [
          new URL("https://example.com"),
          new URL("https://other.example/"),
        ],
      });
      // The gateways and their URLs can be mutated after construction:
      actor.gateways[1].pathname = "/gateway";
      return actor;
    },
    https: (ctx) => new Person({ id: ctx.getActorUri("https") }),
    tombstone: (ctx) =>
      new Tombstone({
        id: ctx.getPortableObjectUri(Person, { name: "tombstone" }, did),
      }),
  };
  federation.setActorDispatcher(
    "/users/{identifier}",
    (ctx, identifier) => actors[identifier]?.(ctx) ?? null,
  );
  federation.setObjectDispatcher(
    Person,
    "/actors/{name}",
    () => null,
  );
  const expected: Record<string, string[]> = {
    valid: [],
    empty: [`ap+ef61://${did}/actors/empty`],
    mutated: [`ap+ef61://${did}/actors/mutated`],
    https: [],
    tombstone: [],
  };
  for (const [identifier, actorIds] of globalThis.Object.entries(expected)) {
    await t.step(identifier, async () => {
      const records = await captureWarnings(async () => {
        await federation.fetch(
          new Request(`https://example.com/users/${identifier}`, {
            headers: { Accept: ACCEPT },
          }),
          { contextData: undefined },
        );
      });
      // A tombstone is logged as a 410 Gone response, not as a warning about
      // the actor:
      const actorRecords = records.filter((r) =>
        r.category.join(".") === "fedify.federation.actor"
      );
      assertEquals(
        actorRecords.map((r) => r.properties.actorId),
        actorIds.map((id) => parseIri(id).href),
      );
      for (const record of actorRecords) {
        assert(String(record.rawMessage).includes("gateways property"));
      }
    });
  }
});
