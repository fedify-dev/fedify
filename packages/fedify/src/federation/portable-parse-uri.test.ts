import { test } from "@fedify/fixture";
import { Note, Object as ASObject, Person } from "@fedify/vocab";
import { exportDidKey, parseIri } from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { ed25519PublicKey } from "../testing/keys.ts";
import type { Context, ParseUriResult } from "./context.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);
const encodedDid = encodeURIComponent(did);

const ORIGIN = "https://example.com";
const NOTE_TYPE_ID = new URL("https://www.w3.org/ns/activitystreams#Note");
const OBJECT_TYPE_ID = new URL("https://www.w3.org/ns/activitystreams#Object");

function createTestFederation() {
  const calls: string[] = [];
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation
    .setActorDispatcher("/users/{identifier}", (_ctx, identifier) => {
      calls.push(`actor:${identifier}`);
      return new Person({});
    })
    .mapActorAlias("/bot", "bot")
    .mapPortableActorId((_ctx, identifier) => {
      calls.push(`portableActorId:${identifier}`);
      return null;
    });
  federation.setObjectDispatcher(
    Note,
    "/users/{identifier}/notes/{id}",
    () => {
      calls.push("object");
      return null;
    },
  );
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
  federation.setOutboxDispatcher("/users/{identifier}/outbox", () => null);
  federation.setFollowingDispatcher(
    "/users/{identifier}/following",
    () => null,
  );
  federation.setFollowersDispatcher(
    "/users/{identifier}/followers",
    () => null,
  );
  federation.setLikedDispatcher("/users/{identifier}/liked", () => null);
  federation.setFeaturedDispatcher("/users/{identifier}/featured", () => null);
  federation.setFeaturedTagsDispatcher(
    "/users/{identifier}/tags",
    () => null,
  );
  federation
    .setCollectionDispatcher(
      "bookmarks",
      ASObject,
      "/users/{identifier}/bookmarks",
      () => null,
    )
    .mapPortableOwner((_ctx, values) => {
      calls.push(`portableOwner:${values.identifier}`);
      return values.identifier;
    });
  federation.setOrderedCollectionDispatcher(
    "pins",
    Note,
    "/users/{identifier}/pins",
    () => null,
  );
  const ctx = federation.createContext(new URL(ORIGIN));
  return { federation, ctx, calls };
}

function portableId(path: string, authority: string = did): URL {
  return parseIri(`ap+ef61://${authority}${path}`);
}

function compatibleId(
  path: string,
  origin: string = ORIGIN,
  authority: string = did,
): URL {
  return new URL(`${origin}/.well-known/apgateway/${authority}${path}`);
}

function parsePortable(ctx: Context<void>, uri: URL): ParseUriResult | null {
  return ctx.parseUri(uri, { portable: true });
}

test("Context.parseUri() does not recognize portable IDs by default", () => {
  const { ctx } = createTestFederation();
  for (
    const uri of [
      portableId("/users/alice"),
      parseIri(`ap://${did}/users/alice`),
      compatibleId("/users/alice"),
      compatibleId("/users/alice", "https://gateway.example"),
    ]
  ) {
    assertEquals(ctx.parseUri(uri), null, uri.href);
    assertEquals(ctx.parseUri(uri, {}), null, uri.href);
    assertEquals(ctx.parseUri(uri, { portable: false }), null, uri.href);
  }
});

test("Context.parseUri() keeps the results of ordinary URIs", () => {
  const { ctx } = createTestFederation();
  for (
    const path of [
      "/users/alice",
      "/bot",
      "/users/alice/notes/123",
      "/inbox",
      "/users/alice/inbox",
      "/users/alice/outbox",
      "/users/alice/following",
      "/users/alice/followers",
      "/users/alice/liked",
      "/users/alice/featured",
      "/users/alice/tags",
      "/users/alice/bookmarks",
      "/users/alice/pins",
      "/nowhere",
    ]
  ) {
    const uri = new URL(path, ORIGIN);
    const result = ctx.parseUri(uri);
    assertEquals(parsePortable(ctx, uri), result, path);
    if (result != null) assertFalse("authority" in result, path);
  }
  assertEquals(
    parsePortable(ctx, new URL("https://other.example/users/alice")),
    null,
  );
  assertEquals(ctx.parseUri(null, { portable: true }), null);
});

test("Context.parseUri() recognizes portable IDs", () => {
  const { ctx, calls } = createTestFederation();
  const identifier = "alice";
  const cases: [string, ParseUriResult][] = [
    ["/users/alice", { type: "actor", identifier, authority: did }],
    ["/bot", { type: "actor", identifier: "bot", authority: did }],
    [
      "/users/alice/notes/123",
      {
        type: "object",
        class: Note,
        typeId: NOTE_TYPE_ID,
        values: { identifier, id: "123" },
        authority: did,
      },
    ],
    ["/users/alice/inbox", { type: "inbox", identifier, authority: did }],
    ["/users/alice/outbox", { type: "outbox", identifier, authority: did }],
    [
      "/users/alice/following",
      { type: "following", identifier, authority: did },
    ],
    [
      "/users/alice/followers",
      { type: "followers", identifier, authority: did },
    ],
    ["/users/alice/liked", { type: "liked", identifier, authority: did }],
    [
      "/users/alice/featured",
      { type: "featured", identifier, authority: did },
    ],
    [
      "/users/alice/tags",
      { type: "featuredTags", identifier, authority: did },
    ],
    [
      "/users/alice/bookmarks",
      {
        type: "collection",
        name: "bookmarks",
        class: ASObject,
        typeId: OBJECT_TYPE_ID,
        values: { identifier },
        authority: did,
      },
    ],
    [
      "/users/alice/pins",
      {
        type: "orderedCollection",
        name: "pins",
        class: Note,
        typeId: NOTE_TYPE_ID,
        values: { identifier },
        authority: did,
      },
    ],
  ];
  for (const [path, expected] of cases) {
    for (
      const uri of [
        portableId(path),
        parseIri(`ap://${did}${path}`),
        new URL(`ap+ef61://${encodedDid}${path}`),
        new URL(`ap://${encodedDid}${path}`),
        compatibleId(path),
        compatibleId(path, "https://gateway.example"),
        compatibleId(path, "http://localhost:8000"),
      ]
    ) {
      assertEquals(parsePortable(ctx, uri), expected, uri.href);
    }
  }
  // Parsing never calls the application's callbacks:
  assertEquals(calls, []);
});

test("Context.parseUri() round-trips the portable ID helpers", () => {
  const { ctx } = createTestFederation();
  const uris: [URL, ParseUriResult["type"]][] = [
    [ctx.getPortableActorUri("alice", did), "actor"],
    [
      ctx.getPortableObjectUri(Note, { identifier: "alice", id: "1" }, did),
      "object",
    ],
    [ctx.getPortableInboxUri("alice", did), "inbox"],
    [ctx.getPortableOutboxUri("alice", did), "outbox"],
    [ctx.getPortableFollowingUri("alice", did), "following"],
    [ctx.getPortableFollowersUri("alice", did), "followers"],
    [ctx.getPortableLikedUri("alice", did), "liked"],
    [ctx.getPortableFeaturedUri("alice", did), "featured"],
    [ctx.getPortableFeaturedTagsUri("alice", did), "featuredTags"],
    [
      ctx.getPortableCollectionUri("bookmarks", { identifier: "alice" }, did),
      "collection",
    ],
    [
      ctx.getPortableCollectionUri("pins", { identifier: "alice" }, did),
      "orderedCollection",
    ],
  ];
  for (const [uri, type] of uris) {
    const result = parsePortable(ctx, uri);
    assertEquals(result?.type, type, uri.href);
    assertEquals(result?.authority, did, uri.href);
  }
});

test("Context.parseUri() returns any DID for the caller to check", () => {
  const { ctx } = createTestFederation();
  assertEquals(
    parsePortable(ctx, portableId("/users/alice", otherDid)),
    { type: "actor", identifier: "alice", authority: otherDid },
  );
  assertEquals(
    parsePortable(
      ctx,
      compatibleId("/users/alice", "https://gateway.example", otherDid),
    ),
    { type: "actor", identifier: "alice", authority: otherDid },
  );
  // Other DID methods are recognized as the gateway endpoint does:
  assertEquals(
    parsePortable(ctx, portableId("/users/alice", "did:web:example.com")),
    { type: "actor", identifier: "alice", authority: "did:web:example.com" },
  );
  // The DID is normalized:
  assertEquals(
    parsePortable(
      ctx,
      parseIri(`ap://DID:KEY:${did.slice("did:key:".length)}/users/alice`),
    ),
    { type: "actor", identifier: "alice", authority: did },
  );
  assertEquals(
    parsePortable(
      ctx,
      new URL(
        `ap://DID%3Akey%3A${did.slice("did:key:".length)}/users/alice`,
      ),
    ),
    { type: "actor", identifier: "alice", authority: did },
  );
});

test("Context.parseUri() ignores the query and fragment of portable IDs", () => {
  const { ctx } = createTestFederation();
  const expected: ParseUriResult = {
    type: "actor",
    identifier: "alice",
    authority: did,
  };
  const hint = "@gateway=https%3A%2F%2Fgateway.example";
  for (
    const uri of [
      parseIri(`ap://${did}/users/alice?${hint}`),
      portableId("/users/alice#main-key"),
      new URL(`${compatibleId("/users/alice").href}?${hint}`),
      new URL(`${compatibleId("/users/alice").href}#main-key`),
    ]
  ) {
    assertEquals(parsePortable(ctx, uri), expected, uri.href);
  }
});

test("Context.parseUri() routes portable paths like ordinary ones", () => {
  const { ctx } = createTestFederation();
  for (const path of ["/users/alice/", "/users/alice/notes/", "/users"]) {
    const ordinary = ctx.parseUri(new URL(path, ORIGIN));
    const expected = ordinary == null
      ? null
      : { ...ordinary, authority: did } as ParseUriResult;
    assertEquals(parsePortable(ctx, portableId(path)), expected, path);
    assertEquals(parsePortable(ctx, compatibleId(path)), expected, path);
  }
});

test("Context.parseUri() does not recognize unroutable portable IDs", () => {
  const { ctx } = createTestFederation();
  for (
    const uri of [
      // No dispatcher matches:
      portableId("/nowhere"),
      compatibleId("/nowhere"),
      // The gateway endpoint serves no shared inbox:
      portableId("/inbox"),
      compatibleId("/inbox"),
      compatibleId("/inbox", "https://gateway.example"),
      // Not a portable object's compatible identifier:
      new URL(`${ORIGIN}/.well-known/apgateway`),
      new URL(`${ORIGIN}/.well-known/apgateway/users/alice`),
      new URL(
        `${ORIGIN}/.well-known/apgateway/hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n`,
      ),
    ]
  ) {
    assertEquals(parsePortable(ctx, uri), null, uri.href);
  }
});

test("Context.parseUri() does not recognize malformed portable IDs", () => {
  const { ctx } = createTestFederation();
  const multibase = did.slice("did:key:".length);
  // A did:key DID encoded in base64url:
  const base64UrlDid = `did:key:u${multibase.slice(1)}`;
  for (
    const uri of [
      new URL(`ap+ef61://${encodeURIComponent(base64UrlDid)}/users/alice`),
      compatibleId("/users/alice", ORIGIN, base64UrlDid),
      new URL("ap+ef61://did%3Akey/users/alice"),
      new URL("ap+ef61://example.com/users/alice"),
      compatibleId("/users/alice", ORIGIN, "did:"),
      compatibleId("/users/alice", "https://gateway.example", "did:key"),
      // Invalid percent-encoding in the path:
      new URL(`ap+ef61://${encodedDid}/users/%ZZ`),
      new URL(`${compatibleId("/users/").href}%ZZ`),
      // Credentials:
      new URL(`ap+ef61://user:pass@${encodedDid}/users/alice`),
      new URL(
        `https://user:pass@gateway.example/.well-known/apgateway/${did}` +
          "/users/alice",
      ),
    ]
  ) {
    assertEquals(parsePortable(ctx, uri), null, uri.href);
  }
});

test("Context.parseUri() prefers the application's routes", () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  federation.setActorDispatcher("/users/{identifier}", () => null);
  federation.setObjectDispatcher(
    Note,
    "/.well-known/apgateway/{+did}/users/{identifier}/notes/{id}",
    () => null,
  );
  federation.setNodeInfoDispatcher(
    `/.well-known/apgateway/${did}/users/alice`,
    () => ({
      software: {
        name: "test",
        version: "1.0.0",
      },
      protocols: ["activitypub"],
      usage: { users: {}, localPosts: 0, localComments: 0 },
    }),
  );
  const ctx = federation.createContext(new URL(ORIGIN));
  // A route on this server's origin whose result is null is not taken for
  // a portable ID:
  assertEquals(parsePortable(ctx, compatibleId("/users/alice")), null);
  assertEquals(
    parsePortable(
      ctx,
      compatibleId("/users/alice", "https://gateway.example"),
    ),
    { type: "actor", identifier: "alice", authority: did },
  );
  const note = parsePortable(ctx, compatibleId("/users/alice/notes/1"));
  assert(note?.type === "object");
  assertEquals(note.values, { did, identifier: "alice", id: "1" });
  assertFalse("authority" in note);
  // Portable IDs are still recognized:
  assertEquals(
    parsePortable(ctx, portableId("/users/alice")),
    { type: "actor", identifier: "alice", authority: did },
  );
});

test("RequestContext.parseUri() recognizes portable IDs", () => {
  const { federation } = createTestFederation();
  const ctx = federation.createContext(
    new Request(compatibleId("/users/alice")),
    undefined,
  );
  assertEquals(ctx.parseUri(portableId("/users/alice")), null);
  assertEquals(
    ctx.parseUri(portableId("/users/alice", otherDid), { portable: true }),
    { type: "actor", identifier: "alice", authority: otherDid },
  );
});
