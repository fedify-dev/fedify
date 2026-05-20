import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import fetchMock from "fetch-mock";
import { getAuthenticatedDocumentLoader } from "../runtime/authdocloader.ts";
import { fetchDocumentLoader, FetchError } from "../runtime/docloader.ts";
import { signRequest, verifyRequest } from "../sig/http.ts";
import type { KeyCache } from "../sig/key.ts";
import {
  compactJsonLd,
  detachSignature,
  signJsonLd,
  verifyJsonLd,
} from "../sig/ld.ts";
import { doesActorOwnKey } from "../sig/owner.ts";
import { signObject, verifyObject } from "../sig/proof.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import personFixture from "../testing/fixtures/example.com/person.json" with {
  type: "json",
};
import person2Fixture from "../testing/fixtures/example.com/person2.json" with {
  type: "json",
};
import {
  ed25519Multikey,
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import { lookupObject } from "../vocab/lookup.ts";
import { getTypeId } from "../vocab/type.ts";
import {
  Activity,
  Announce,
  Create,
  type CryptographicKey,
  Invite,
  Multikey,
  Note,
  Object,
  Offer,
  Person,
} from "../vocab/vocab.ts";
import type { Context } from "./context.ts";
import { MemoryKvStore } from "./kv.ts";
import {
  ContextImpl,
  createFederation,
  FederationImpl,
  InboxContextImpl,
  KvSpecDeterminer,
} from "./middleware.ts";
import type { MessageQueue } from "./mq.ts";
import type { InboxMessage, Message, OutboxMessage } from "./queue.ts";
import { RouterError } from "./router.ts";

test("createFederation()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("allowPrivateAddress", () => {
    assertThrows(() =>
      createFederation<number>({
        kv,
        documentLoader: mockDocumentLoader,
        allowPrivateAddress: true,
      }), TypeError);
    assertThrows(() =>
      createFederation<number>({
        kv,
        contextLoader: mockDocumentLoader,
        allowPrivateAddress: true,
      }), TypeError);
    assertThrows(() =>
      createFederation<number>({
        kv,
        authenticatedDocumentLoaderFactory: () => mockDocumentLoader,
        allowPrivateAddress: true,
      }), TypeError);
  });

  await t.step("origin", () => {
    const f = createFederation<void>({ kv, origin: "http://example.com:8080" });
    assertInstanceOf(f, FederationImpl);
    assertEquals(f.origin, {
      handleHost: "example.com:8080",
      webOrigin: "http://example.com:8080",
    });

    assertThrows(
      () => createFederation<void>({ kv, origin: "example.com" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "ftp://example.com" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "https://example.com/foo" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "https://example.com/?foo" }),
      TypeError,
    );
    assertThrows(
      () => createFederation<void>({ kv, origin: "https://example.com/#foo" }),
      TypeError,
    );

    const f2 = createFederation<void>({
      kv,
      origin: {
        handleHost: "example.com:8080",
        webOrigin: "https://ap.example.com",
      },
    });
    assertInstanceOf(f2, FederationImpl);
    assertEquals(f2.origin, {
      handleHost: "example.com:8080",
      webOrigin: "https://ap.example.com",
    });

    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "https://example.com",
            webOrigin: "https://example.com",
          },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com/",
            webOrigin: "https://example.com",
          },
        }),
      TypeError,
    );

    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: { handleHost: "example.com", webOrigin: "example.com" },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: { handleHost: "example.com", webOrigin: "ftp://example.com" },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com",
            webOrigin: "https://example.com/foo",
          },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com",
            webOrigin: "https://example.com/?foo",
          },
        }),
      TypeError,
    );
    assertThrows(
      () =>
        createFederation<void>({
          kv,
          origin: {
            handleHost: "example.com",
            webOrigin: "https://example.com/#foo",
          },
        }),
      TypeError,
    );
  });
});

test({
  name: "Federation.createContext()",
  permissions: { env: true, read: true },
  async fn(t) {
    const kv = new MemoryKvStore();
    const documentLoader = (url: string) => {
      throw new FetchError(new URL(url), "Not found");
    };

    fetchMock.spyGlobal();

    fetchMock.get("https://example.com/object", async (cl) => {
      const v = await verifyRequest(
        cl.request!,
        {
          contextLoader: mockDocumentLoader,
          documentLoader: mockDocumentLoader,
          currentTime: Temporal.Now.instant(),
        },
      );
      return new Response(JSON.stringify(v != null), {
        headers: { "Content-Type": "application/json" },
      });
    });

    await t.step("Context", async () => {
      const federation = createFederation<number>({
        kv,
        documentLoader,
        contextLoader: mockDocumentLoader,
      });
      let ctx = federation.createContext(
        new URL("https://example.com:1234/"),
        123,
      );
      assertEquals(ctx.data, 123);
      assertEquals(ctx.origin, "https://example.com:1234");
      assertEquals(ctx.canonicalOrigin, "https://example.com:1234");
      assertEquals(ctx.host, "example.com:1234");
      assertEquals(ctx.hostname, "example.com");
      assertStrictEquals(ctx.documentLoader, documentLoader);
      assertStrictEquals(ctx.contextLoader, mockDocumentLoader);
      assertStrictEquals(ctx.federation, federation);
      assertThrows(() => ctx.getNodeInfoUri(), RouterError);
      assertThrows(() => ctx.getActorUri("handle"), RouterError);
      assertThrows(
        () => ctx.getObjectUri(Note, { handle: "handle", id: "id" }),
        RouterError,
      );
      assertThrows(() => ctx.getInboxUri(), RouterError);
      assertThrows(() => ctx.getInboxUri("handle"), RouterError);
      assertThrows(() => ctx.getOutboxUri("handle"), RouterError);
      assertThrows(() => ctx.getFollowingUri("handle"), RouterError);
      assertThrows(() => ctx.getFollowersUri("handle"), RouterError);
      assertThrows(() => ctx.getLikedUri("handle"), RouterError);
      assertThrows(() => ctx.getFeaturedUri("handle"), RouterError);
      assertThrows(() => ctx.getFeaturedTagsUri("handle"), RouterError);
      assertThrows(
        () => ctx.getCollectionUri("test", { id: "123" }),
        RouterError,
      );
      assertEquals(ctx.parseUri(new URL("https://example.com/")), null);
      assertEquals(ctx.parseUri(null), null);
      assertEquals(await ctx.getActorKeyPairs("handle"), []);
      await assertRejects(
        () => ctx.getDocumentLoader({ identifier: "handle" }),
        Error,
        "No actor key pairs dispatcher registered",
      );
      await assertRejects(
        () => ctx.sendActivity({ identifier: "handle" }, [], new Create({})),
        Error,
        "No actor key pairs dispatcher registered",
      );

      federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
        software: {
          name: "Example",
          version: { major: 1, minor: 2, patch: 3 },
        },
        protocols: ["activitypub"],
        usage: {
          users: {},
          localPosts: 123,
          localComments: 456,
        },
      }));
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getNodeInfoUri(),
        new URL("https://example.com/nodeinfo/2.1"),
      );

      federation
        .setActorDispatcher("/users/{identifier}", () => new Person({}))
        .setKeyPairsDispatcher(() => [
          {
            privateKey: rsaPrivateKey2,
            publicKey: rsaPublicKey2.publicKey!,
          },
          {
            privateKey: ed25519PrivateKey,
            publicKey: ed25519PublicKey.publicKey!,
          },
        ])
        .mapHandle((_, username) => username === "HANDLE" ? "handle" : null);
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getActorUri("handle"),
        new URL("https://example.com/users/handle"),
      );
      assertEquals(ctx.parseUri(new URL("https://example.com/")), null);
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle")),
        { type: "actor", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);
      assertEquals(
        await ctx.getActorKeyPairs("handle"),
        [
          {
            keyId: new URL("https://example.com/users/handle#main-key"),
            privateKey: rsaPrivateKey2,
            publicKey: rsaPublicKey2.publicKey!,
            cryptographicKey: rsaPublicKey2.clone({
              id: new URL("https://example.com/users/handle#main-key"),
              owner: new URL("https://example.com/users/handle"),
            }),
            multikey: new Multikey({
              id: new URL("https://example.com/users/handle#multikey-1"),
              controller: new URL("https://example.com/users/handle"),
              publicKey: rsaPublicKey2.publicKey!,
            }),
          },
          {
            keyId: new URL("https://example.com/users/handle#key-2"),
            privateKey: ed25519PrivateKey,
            publicKey: ed25519PublicKey.publicKey!,
            cryptographicKey: ed25519PublicKey.clone({
              id: new URL("https://example.com/users/handle#key-2"),
              owner: new URL("https://example.com/users/handle"),
            }),
            multikey: new Multikey({
              id: new URL("https://example.com/users/handle#multikey-2"),
              controller: new URL("https://example.com/users/handle"),
              publicKey: ed25519PublicKey.publicKey!,
            }),
          },
        ],
      );
      const loader = await ctx.getDocumentLoader({ identifier: "handle" });
      assertEquals(await loader("https://example.com/object"), {
        contextUrl: null,
        documentUrl: "https://example.com/object",
        document: true,
      });
      const loader2 = await ctx.getDocumentLoader({ username: "HANDLE" });
      assertEquals(await loader2("https://example.com/object"), {
        contextUrl: null,
        documentUrl: "https://example.com/object",
        document: true,
      });
      const loader3 = ctx.getDocumentLoader({
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      });
      assertEquals(await loader3("https://example.com/object"), {
        contextUrl: null,
        documentUrl: "https://example.com/object",
        document: true,
      });
      assertEquals(await ctx.lookupObject("https://example.com/object"), null);
      await assertRejects(
        () => ctx.sendActivity({ identifier: "handle" }, [], new Create({})),
        TypeError,
        "The activity to send must have at least one actor property.",
      );
      await ctx.sendActivity(
        { identifier: "handle" },
        [],
        new Create({
          actor: new URL("https://example.com/users/handle"),
        }),
      );

      const federation2 = createFederation<number>({
        kv,
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      });
      const ctx2 = federation2.createContext(
        new URL("https://example.com/"),
        123,
      );
      assertEquals(
        await ctx2.lookupObject("https://example.com/object"),
        new Object({
          id: new URL("https://example.com/object"),
          name: "Fetched object",
        }),
      );

      federation.setObjectDispatcher(
        Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getObjectUri(Note, { identifier: "john", id: "123" }),
        new URL("https://example.com/users/john/notes/123"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/john/notes/123")),
        {
          type: "object",
          class: Note,
          typeId: new URL("https://www.w3.org/ns/activitystreams#Note"),
          values: { identifier: "john", id: "123" },
        },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(ctx.getInboxUri(), new URL("https://example.com/inbox"));
      assertEquals(
        ctx.getInboxUri("handle"),
        new URL("https://example.com/users/handle/inbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/inbox")),
        { type: "inbox", identifier: undefined, handle: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/inbox")),
        { type: "inbox", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setOutboxDispatcher(
        "/users/{identifier}/outbox",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getOutboxUri("handle"),
        new URL("https://example.com/users/handle/outbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/outbox")),
        { type: "outbox", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFollowingDispatcher(
        "/users/{identifier}/following",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFollowingUri("handle"),
        new URL("https://example.com/users/handle/following"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/following")),
        { type: "following", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFollowersDispatcher(
        "/users/{identifier}/followers",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFollowersUri("handle"),
        new URL("https://example.com/users/handle/followers"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/followers")),
        { type: "followers", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setLikedDispatcher(
        "/users/{identifier}/liked",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getLikedUri("handle"),
        new URL("https://example.com/users/handle/liked"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/liked")),
        { type: "liked", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFeaturedDispatcher(
        "/users/{identifier}/featured",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFeaturedUri("handle"),
        new URL("https://example.com/users/handle/featured"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/featured")),
        { type: "featured", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);

      federation.setFeaturedTagsDispatcher(
        "/users/{identifier}/tags",
        () => ({ items: [] }),
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getFeaturedTagsUri("handle"),
        new URL("https://example.com/users/handle/tags"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/tags")),
        { type: "featuredTags", identifier: "handle", handle: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);
    });

    await t.step("Context with origin", () => {
      const federation = createFederation<void>({
        kv,
        origin: "https://ap.example.com",
        documentLoader,
        contextLoader: mockDocumentLoader,
      });
      const ctx = federation.createContext(
        new URL("https://example.com:1234/"),
      );
      assertEquals(ctx.origin, "https://example.com:1234");
      assertEquals(ctx.canonicalOrigin, "https://ap.example.com");
      assertEquals(ctx.host, "example.com:1234");
      assertEquals(ctx.hostname, "example.com");

      federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
        software: {
          name: "Example",
          version: { major: 1, minor: 2, patch: 3 },
        },
        protocols: ["activitypub"],
        usage: {
          users: {},
          localPosts: 123,
          localComments: 456,
        },
      }));
      assertEquals(
        ctx.getNodeInfoUri(),
        new URL("https://ap.example.com/nodeinfo/2.1"),
      );

      federation.setActorDispatcher(
        "/users/{identifier}",
        () => new Person({}),
      );
      assertEquals(
        ctx.getActorUri("handle"),
        new URL("https://ap.example.com/users/handle"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle")),
        { type: "actor", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle")),
        { type: "actor", handle: "handle", identifier: "handle" },
      );

      federation.setObjectDispatcher(
        Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      assertEquals(
        ctx.getObjectUri(Note, { identifier: "john", id: "123" }),
        new URL("https://ap.example.com/users/john/notes/123"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/john/notes/123")),
        {
          type: "object",
          class: Note,
          typeId: new URL("https://www.w3.org/ns/activitystreams#Note"),
          values: { identifier: "john", id: "123" },
        },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/john/notes/123")),
        {
          type: "object",
          class: Note,
          typeId: new URL("https://www.w3.org/ns/activitystreams#Note"),
          values: { identifier: "john", id: "123" },
        },
      );

      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
      assertEquals(ctx.getInboxUri(), new URL("https://ap.example.com/inbox"));
      assertEquals(
        ctx.getInboxUri("handle"),
        new URL("https://ap.example.com/users/handle/inbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/inbox")),
        { type: "inbox", handle: undefined, identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/inbox")),
        { type: "inbox", handle: undefined, identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/inbox")),
        { type: "inbox", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/inbox")),
        { type: "inbox", handle: "handle", identifier: "handle" },
      );

      federation.setOutboxDispatcher(
        "/users/{identifier}/outbox",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getOutboxUri("handle"),
        new URL("https://ap.example.com/users/handle/outbox"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/outbox")),
        { type: "outbox", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/outbox")),
        { type: "outbox", handle: "handle", identifier: "handle" },
      );

      federation.setFollowingDispatcher(
        "/users/{identifier}/following",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFollowingUri("handle"),
        new URL("https://ap.example.com/users/handle/following"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/following")),
        { type: "following", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(
          new URL("https://example.com:1234/users/handle/following"),
        ),
        { type: "following", handle: "handle", identifier: "handle" },
      );

      federation.setFollowersDispatcher(
        "/users/{identifier}/followers",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFollowersUri("handle"),
        new URL("https://ap.example.com/users/handle/followers"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/followers")),
        { type: "followers", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(
          new URL("https://example.com:1234/users/handle/followers"),
        ),
        { type: "followers", handle: "handle", identifier: "handle" },
      );

      federation.setLikedDispatcher(
        "/users/{identifier}/liked",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getLikedUri("handle"),
        new URL("https://ap.example.com/users/handle/liked"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/liked")),
        { type: "liked", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/liked")),
        { type: "liked", handle: "handle", identifier: "handle" },
      );

      federation.setFeaturedDispatcher(
        "/users/{identifier}/featured",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFeaturedUri("handle"),
        new URL("https://ap.example.com/users/handle/featured"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/featured")),
        { type: "featured", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/featured")),
        { type: "featured", handle: "handle", identifier: "handle" },
      );

      federation.setFeaturedTagsDispatcher(
        "/users/{identifier}/tags",
        () => ({ items: [] }),
      );
      assertEquals(
        ctx.getFeaturedTagsUri("handle"),
        new URL("https://ap.example.com/users/handle/tags"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/tags")),
        { type: "featuredTags", handle: "handle", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/tags")),
        { type: "featuredTags", handle: "handle", identifier: "handle" },
      );
    });

    await t.step("Context.clone()", () => {
      const federation = createFederation<number>({
        kv,
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        123,
      );
      const clone = ctx.clone(456);
      assertStrictEquals(clone.canonicalOrigin, ctx.canonicalOrigin);
      assertStrictEquals(clone.origin, ctx.origin);
      assertEquals(clone.data, 456);
      assertEquals(clone.host, ctx.host);
      assertEquals(clone.hostname, ctx.hostname);
      assertStrictEquals(clone.documentLoader, ctx.documentLoader);
      assertStrictEquals(clone.contextLoader, ctx.contextLoader);
      assertStrictEquals(clone.federation, ctx.federation);
    });

    fetchMock.get("https://example.com/.well-known/nodeinfo", (cl) => {
      const headers = (cl.options.headers ?? {}) as
        | [string, string][]
        | Record<string, string>
        | Headers;
      assertEquals(
        new Headers(headers).get("User-Agent"),
        "CustomUserAgent/1.2.3",
      );
      return new Response(
        JSON.stringify({
          links: [
            {
              rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
              href: "https://example.com/nodeinfo/2.1",
            },
          ],
        }),
      );
    });

    fetchMock.get("https://example.com/nodeinfo/2.1", (cl) => {
      const headers = (cl.options.headers ?? {}) as
        | [string, string][]
        | Record<string, string>
        | Headers;
      assertEquals(
        new Headers(headers).get("User-Agent"),
        "CustomUserAgent/1.2.3",
      );
      return new Response(JSON.stringify({
        software: { name: "foo", version: "1.2.3" },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      }));
    });

    await t.step("Context.lookupNodeInfo()", async () => {
      const federation = createFederation<number>({
        kv,
        userAgent: "CustomUserAgent/1.2.3",
      });
      const ctx = federation.createContext(
        new URL("https://example.com/"),
        123,
      );
      const nodeInfo = await ctx.lookupNodeInfo("https://example.com/");
      assertEquals(nodeInfo, {
        software: {
          name: "foo",
          version: { major: 1, minor: 2, patch: 3, build: [], prerelease: [] },
        },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      });

      const rawNodeInfo = await ctx.lookupNodeInfo("https://example.com/", {
        parse: "none",
      });
      assertEquals(rawNodeInfo, {
        software: { name: "foo", version: "1.2.3" },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      });
    });

    await t.step("RequestContext", async () => {
      const federation = createFederation<number>({
        kv,
        documentLoader: mockDocumentLoader,
      });
      const req = new Request("https://example.com/");
      const ctx = federation.createContext(req, 123);
      assertEquals(ctx.request, req);
      assertEquals(ctx.url, new URL("https://example.com/"));
      assertEquals(ctx.origin, "https://example.com");
      assertEquals(ctx.host, "example.com");
      assertEquals(ctx.hostname, "example.com");
      assertEquals(ctx.data, 123);
      await assertRejects(
        () => ctx.getActor("someone"),
        Error,
      );
      await assertRejects(
        () => ctx.getObject(Note, { handle: "someone", id: "123" }),
        Error,
      );
      assertEquals(await ctx.getSignedKey(), null);
      assertEquals(await ctx.getSignedKeyOwner(), null);
      // Multiple calls should return the same result:
      assertEquals(await ctx.getSignedKey(), null);
      assertEquals(await ctx.getSignedKeyOwner(), null);
      await assertRejects(
        () => ctx.getActor("someone"),
        Error,
        "No actor dispatcher registered",
      );

      const signedReq = await signRequest(
        new Request("https://example.com/"),
        rsaPrivateKey2,
        rsaPublicKey2.id!,
      );
      const signedCtx = federation.createContext(signedReq, 456);
      assertEquals(signedCtx.request, signedReq);
      assertEquals(signedCtx.url, new URL("https://example.com/"));
      assertEquals(signedCtx.data, 456);
      assertEquals(await signedCtx.getSignedKey(), rsaPublicKey2);
      assertEquals(await signedCtx.getSignedKeyOwner(), null);
      // Multiple calls should return the same result:
      assertEquals(await signedCtx.getSignedKey(), rsaPublicKey2);
      assertEquals(await signedCtx.getSignedKeyOwner(), null);

      const signedReq2 = await signRequest(
        new Request("https://example.com/"),
        rsaPrivateKey3,
        rsaPublicKey3.id!,
      );
      const signedCtx2 = federation.createContext(signedReq2, 456);
      assertEquals(signedCtx2.request, signedReq2);
      assertEquals(signedCtx2.url, new URL("https://example.com/"));
      assertEquals(signedCtx2.data, 456);
      assertEquals(await signedCtx2.getSignedKey(), rsaPublicKey3);
      const expectedOwner = await lookupObject(
        "https://example.com/person2",
        {
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
        },
      );
      assertEquals(await signedCtx2.getSignedKeyOwner(), expectedOwner);
      // Multiple calls should return the same result:
      assertEquals(await signedCtx2.getSignedKey(), rsaPublicKey3);
      assertEquals(await signedCtx2.getSignedKeyOwner(), expectedOwner);

      federation.setActorDispatcher(
        "/users/{identifier}",
        (_ctx, identifier) => new Person({ preferredUsername: identifier }),
      );
      const ctx2 = federation.createContext(req, 789);
      assertEquals(ctx2.request, req);
      assertEquals(ctx2.url, new URL("https://example.com/"));
      assertEquals(ctx2.data, 789);
      assertEquals(
        await ctx2.getActor("john"),
        new Person({ preferredUsername: "john" }),
      );

      federation.setObjectDispatcher(
        Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      const ctx3 = federation.createContext(req, 123);
      assertEquals(ctx3.request, req);
      assertEquals(ctx3.url, new URL("https://example.com/"));
      assertEquals(ctx3.data, 123);
      assertEquals(
        await ctx2.getObject(Note, { identifier: "john", id: "123" }),
        new Note({ summary: "Note 123 by john" }),
      );
    });

    await t.step("RequestContext.clone()", () => {
      const federation = createFederation<number>({
        kv,
      });
      const req = new Request("https://example.com/");
      const ctx = federation.createContext(req, 123);
      const clone = ctx.clone(456);
      assertStrictEquals(clone.request, ctx.request);
      assertEquals(clone.url, ctx.url);
      assertEquals(clone.data, 456);
      assertEquals(clone.origin, ctx.origin);
      assertEquals(clone.host, ctx.host);
      assertEquals(clone.hostname, ctx.hostname);
      assertStrictEquals(clone.documentLoader, ctx.documentLoader);
      assertStrictEquals(clone.contextLoader, ctx.contextLoader);
      assertStrictEquals(clone.federation, ctx.federation);
    });

    fetchMock.hardReset();
  },
});

test("Federation.setInboxListeners()", async (t) => {
  const kv = new MemoryKvStore();

  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/key2", {
    headers: { "Content-Type": "application/activity+json" },
    body: await rsaPublicKey2.toJsonLd({ contextLoader: mockDocumentLoader }),
  });

  fetchMock.get("begin:https://example.com/person2", {
    headers: { "Content-Type": "application/activity+json" },
    body: person2Fixture,
  });

  fetchMock.get("begin:https://example.com/person", {
    headers: { "Content-Type": "application/activity+json" },
    body: personFixture,
  });

  await t.step("path match", () => {
    const federation = createFederation<void>({
      kv,
      documentLoader: mockDocumentLoader,
    });
    federation.setInboxDispatcher(
      "/users/{identifier}/inbox",
      () => ({ items: [] }),
    );
    assertThrows(
      () => federation.setInboxListeners("/users/{identifier}/inbox2"),
      RouterError,
    );
  });

  await t.step("wrong variables in path", () => {
    const federation = createFederation<void>({
      kv,
      documentLoader: mockDocumentLoader,
    });
    assertThrows(
      () =>
        federation.setInboxListeners(
          "/users/inbox" as `${string}{identifier}${string}`,
        ),
      RouterError,
    );
    assertThrows(
      () => federation.setInboxListeners("/users/{identifier}/inbox/{id2}"),
      RouterError,
    );
    assertThrows(
      () => federation.setInboxListeners("/users/{identifier}/inbox/{handle}"),
      RouterError,
    );
    assertThrows(
      () =>
        federation.setInboxListeners(
          "/users/{identifier2}/inbox" as `${string}{identifier}${string}`,
        ),
      RouterError,
    );
  });

  await t.step("on()", async () => {
    const authenticatedRequests: [string, string][] = [];
    const federation = createFederation<void>({
      kv,
      documentLoader: mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity);
        return (url: string) => {
          const urlObj = new URL(url);
          authenticatedRequests.push([url, identity.keyId.href]);
          if (urlObj.host === "example.com") return docLoader(url);
          return mockDocumentLoader(url);
        };
      },
    });
    const inbox: [Context<void>, Create][] = [];
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, (ctx, create) => {
        inbox.push([ctx, create]);
      });

    let response = await federation.fetch(
      new Request("https://example.com/inbox", { method: "POST" }),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 404);

    federation
      .setActorDispatcher(
        "/users/{identifier}",
        (_, identifier) => identifier === "john" ? new Person({}) : null,
      )
      .setKeyPairsDispatcher(() => [{
        privateKey: rsaPrivateKey2,
        publicKey: rsaPublicKey2.publicKey!,
      }]);
    const options = {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    };
    const activity = () =>
      new Create({
        id: new URL("https://example.com/activities/" + crypto.randomUUID()),
        actor: new URL("https://example.com/person2"),
      });
    response = await federation.fetch(
      new Request(
        "https://example.com/inbox",
        {
          method: "POST",
          body: JSON.stringify(await activity().toJsonLd(options)),
        },
      ),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 401);

    response = await federation.fetch(
      new Request("https://example.com/users/no-one/inbox", { method: "POST" }),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 404);

    response = await federation.fetch(
      new Request(
        "https://example.com/users/john/inbox",
        {
          method: "POST",
          body: JSON.stringify(await activity().toJsonLd(options)),
        },
      ),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 401);

    // Personal inbox + HTTP Signatures (RSA)
    const activityPayload = await activity().toJsonLd(options);
    let request = new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(activityPayload),
    });
    request = await signRequest(
      request,
      rsaPrivateKey3,
      new URL("https://example.com/person2#key3"),
    );
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, [
      ["https://example.com/person", "https://example.com/users/john#main-key"],
    ]);

    // Idempotence check
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);

    // Idempotence check with different origin (host)
    inbox.shift();
    request = new Request("https://another.host/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(activityPayload),
    });
    request = await signRequest(
      request,
      rsaPrivateKey3,
      new URL("https://example.com/person2#key3"),
    );
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, [
      [
        "https://example.com/person",
        "https://another.host/users/john#main-key",
      ],
    ]);

    // Shared inbox + HTTP Signatures (RSA)
    inbox.shift();
    request = new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(await activity().toJsonLd(options)),
    });
    request = await signRequest(
      request,
      rsaPrivateKey3,
      new URL("https://example.com/person2#key3"),
    );
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, []);

    // Object Integrity Proofs (Ed25519)
    inbox.shift();
    request = new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(
        await (await signObject(
          activity(),
          ed25519PrivateKey,
          ed25519Multikey.id!,
          options,
        )).toJsonLd(options),
      ),
    });
    response = await federation.fetch(request, { contextData: undefined });
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0][1].actorId, new URL("https://example.com/person2"));
    assertEquals(response.status, 202);

    while (authenticatedRequests.length > 0) authenticatedRequests.shift();
    assertEquals(authenticatedRequests, []);
    await inbox[0][0].documentLoader("https://example.com/person");
    assertEquals(authenticatedRequests, [
      ["https://example.com/person", "https://example.com/users/john#main-key"],
    ]);
  });

  await t.step("onError()", async () => {
    const federation = createFederation<void>({
      kv,
      documentLoader: mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity);
        return (url: string) => {
          const urlObj = new URL(url);
          if (urlObj.host === "example.com") return docLoader(url);
          return mockDocumentLoader(url);
        };
      },
    });
    federation
      .setActorDispatcher(
        "/users/{identifier}",
        (_, identifier) => identifier === "john" ? new Person({}) : null,
      )
      .setKeyPairsDispatcher(() => [{
        privateKey: rsaPrivateKey2,
        publicKey: rsaPublicKey2.publicKey!,
      }]);
    const error = new Error("test");
    const errors: unknown[] = [];
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, () => {
        throw error;
      })
      .onError((_, e) => {
        errors.push(e);
      });

    const activity = new Create({
      actor: new URL("https://example.com/person"),
    });
    let request = new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(
        await activity.toJsonLd({ contextLoader: mockDocumentLoader }),
      ),
    });
    request = await signRequest(
      request,
      rsaPrivateKey2,
      new URL("https://example.com/key2"),
    );
    const response = await federation.fetch(request, {
      contextData: undefined,
    });
    assertEquals(errors.length, 1);
    assertEquals(errors[0], error);
    assertEquals(response.status, 500);
  });

  fetchMock.hardReset();
});

test("Federation.fetch() preserves original LD-signed payload for InboxContextImpl.activity", async () => {
  const remoteContextUrl = "https://remote.example/contexts/ext";
  const sourceContextLoader = async (resource: string) => {
    const url = new URL(resource).href;
    if (url === remoteContextUrl) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": {
            ext: "https://example.com/ext",
          },
        },
      };
    }
    return await mockDocumentLoader(url);
  };
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoader: mockDocumentLoader,
    contextLoader: sourceContextLoader,
  });
  federation.setActorDispatcher(
    "/users/{identifier}",
    (_ctx, identifier) => identifier === "someone" ? new Person({}) : null,
  );
  let receivedRaw: unknown = null;
  let receivedTyped: Create | null = null;
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, (ctx, activity) => {
      receivedRaw = (ctx as unknown as { activity: unknown }).activity;
      receivedTyped = activity;
    });
  const signed = await signJsonLd(
    {
      "@context": [
        remoteContextUrl,
        "https://www.w3.org/ns/activitystreams",
      ],
      id: "https://example.com/activities/preserve-raw",
      type: "Create",
      actor: "https://example.com/person2",
      ext: "preserve-me",
      object: {
        id: "https://example.com/notes/preserve-raw",
        type: "Note",
        attributedTo: "https://example.com/person2",
        content: "Hello, world!",
      },
    },
    rsaPrivateKey3,
    rsaPublicKey3.id!,
    { contextLoader: sourceContextLoader },
  );
  const response = await federation.fetch(
    new Request("https://example.com/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: JSON.stringify(signed),
    }),
    { contextData: undefined },
  );
  assertEquals([response.status, await response.text()], [202, ""]);
  assertEquals(receivedRaw, signed);
  assertNotEquals(
    receivedRaw,
    await compactJsonLd(signed, sourceContextLoader),
  );
  const delivered = receivedTyped;
  assert(delivered != null);
  assertEquals(
    (delivered as Create).id?.href,
    "https://example.com/activities/preserve-raw",
  );
});

test("Federation.setInboxDispatcher()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("path match", () => {
    const federation = createFederation<void>({
      kv,
      documentLoader: mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox");
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/{identifier}/inbox2",
          () => ({ items: [] }),
        ),
      RouterError,
    );
  });

  await t.step("path match", () => {
    const federation = createFederation<void>({
      kv,
      documentLoader: mockDocumentLoader,
    });
    federation.setInboxListeners("/users/{identifier}/inbox");
    federation.setInboxDispatcher(
      "/users/{identifier}/inbox",
      () => ({ items: [] }),
    );
  });

  await t.step("wrong variables in path", () => {
    const federation = createFederation<void>({
      kv,
      documentLoader: mockDocumentLoader,
    });
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/inbox" as `${string}{identifier}${string}`,
          () => ({ items: [] }),
        ),
      RouterError,
    );
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/{identifier}/inbox/{identifier2}",
          () => ({ items: [] }),
        ),
      RouterError,
    );
    assertThrows(
      () =>
        federation.setInboxDispatcher(
          "/users/{identifier2}/inbox" as `${string}{identifier}${string}`,
          () => ({ items: [] }),
        ),
      RouterError,
    );
  });
});

test("FederationImpl.sendActivity()", async (t) => {
  fetchMock.spyGlobal();

  let verified: ("http" | "ld" | "proof")[] | null = null;
  let request: Request | null = null;
  fetchMock.post("https://example.com/inbox", async (cl) => {
    verified = [];
    request = cl.request!.clone() as Request;
    const options = {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    };
    let json = await cl.request!.json();
    if (await verifyJsonLd(json, options)) verified.push("ld");
    json = detachSignature(json);
    let activity = await verifyObject(Activity, json, options);
    if (activity == null) {
      activity = await Activity.fromJsonLd(json, options);
    } else {
      verified.push("proof");
    }
    const key = await verifyRequest(request, options);
    if (key != null && await doesActorOwnKey(activity, key, options)) {
      verified.push("http");
    }
    if (verified.length > 0) return new Response(null, { status: 202 });
    return new Response(null, { status: 401 });
  });

  const kv = new MemoryKvStore();
  const federation = new FederationImpl<void>({
    kv,
    contextLoader: mockDocumentLoader,
  });
  const context = federation.createContext(new URL("https://example.com/"));

  await t.step("success", async () => {
    const activity = new Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    const inboxes = {
      "https://example.com/inbox": {
        actorIds: ["https://example.com/recipient"],
        sharedInbox: false,
      },
    };
    await federation.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      inboxes,
      activity,
      { context },
    );
    assertEquals(verified, ["http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await federation.sendActivity(
      [{ privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! }],
      inboxes,
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
      { context },
    );
    assertEquals(verified, ["ld", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await federation.sendActivity(
      [
        { privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! },
      ],
      inboxes,
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
      { context },
    );
    assertEquals(verified, ["proof"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await federation.sendActivity(
      [
        { privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! },
        { privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! },
      ],
      inboxes,
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
      { context },
    );
    assertEquals(verified, ["ld", "proof", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );
  });

  fetchMock.hardReset();
});

test("FederationImpl.processQueuedTask()", async (t) => {
  await t.step("with MessageQueue having nativeRetrial", async () => {
    const kv = new MemoryKvStore();
    const queuedMessages: Message[] = [];
    const queue: MessageQueue = {
      nativeRetrial: true,
      enqueue(message, _options) {
        queuedMessages.push(message);
        return Promise.resolve();
      },
      listen(_handler, _options) {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv,
      queue,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, () => {
        throw new Error("Intended error for testing");
      });

    // outbox message
    await assertRejects(
      () =>
        federation.processQueuedTask(
          undefined,
          {
            type: "outbox",
            id: crypto.randomUUID(),
            baseUrl: "https://example.com",
            keys: [],
            activity: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Create",
              actor: "https://example.com/users/alice",
              object: { type: "Note", content: "test" },
            },
            activityType: "https://www.w3.org/ns/activitystreams#Create",
            inbox: "https://invalid-domain-that-does-not-exist.example/inbox",
            sharedInbox: false,
            started: new Date().toISOString(),
            attempt: 0,
            headers: {},
            traceContext: {},
          } satisfies OutboxMessage,
        ),
      Error,
    );
    assertEquals(queuedMessages, []);

    // inbox message
    await assertRejects(
      () =>
        federation.processQueuedTask(
          undefined,
          {
            type: "inbox",
            id: crypto.randomUUID(),
            baseUrl: "https://example.com",
            activity: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Create",
              actor: "https://remote.example/users/alice",
              object: {
                type: "Note",
                content: "Hello world",
              },
            },
            started: new Date().toISOString(),
            attempt: 0,
            identifier: null,
            traceContext: {},
          } satisfies InboxMessage,
        ),
      Error,
    );
    assertEquals(queuedMessages, []);
  });

  await t.step("with MessageQueue having no nativeRetrial", async () => {
    const kv = new MemoryKvStore();
    let queuedMessages: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message, _options) {
        queuedMessages.push(message);
        return Promise.resolve();
      },
      listen(_handler, _options) {
        return Promise.resolve();
      },
    };
    const federation = new FederationImpl<void>({
      kv,
      queue,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, () => {
        throw new Error("Intended error for testing");
      });

    // outbox message
    const outboxMessage: OutboxMessage = {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      keys: [],
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: "https://example.com/users/alice",
        object: { type: "Note", content: "test" },
      },
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      inbox: "https://invalid-domain-that-does-not-exist.example/inbox",
      sharedInbox: false,
      started: new Date().toISOString(),
      attempt: 0,
      headers: {},
      traceContext: {},
    };
    await federation.processQueuedTask(undefined, outboxMessage);
    assertEquals(queuedMessages, [{ ...outboxMessage, attempt: 1 }]);
    queuedMessages = [];

    // inbox message
    const inboxMessage: InboxMessage = {
      type: "inbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        actor: "https://remote.example/users/alice",
        object: {
          type: "Note",
          content: "Hello world",
        },
      },
      started: new Date().toISOString(),
      attempt: 0,
      identifier: null,
      traceContext: {},
    };
    await federation.processQueuedTask(undefined, inboxMessage);
    assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
  });

  await t.step(
    "with restrictive context loader and normalized LD-signed inbox activity",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const sourceContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      };
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const kv = new MemoryKvStore();
      let receivedCount = 0;
      let received: Create | null = null;
      let receivedRaw: unknown = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoader: restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (ctx, activity) => {
          receivedCount++;
          receivedRaw = (ctx as unknown as { activity: unknown }).activity;
          received = activity;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/1",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/1",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello, world!",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: sourceContextLoader },
      );
      const normalizedActivity = await compactJsonLd(
        signed,
        sourceContextLoader,
      );
      const messageId = crypto.randomUUID();
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: messageId,
          baseUrl: "https://example.com",
          activity: signed,
          normalizedActivity,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      const delivered = received;
      assert(delivered != null);
      const deliveredCreate = delivered as Create;
      assertInstanceOf(deliveredCreate, Create);
      assertEquals(
        deliveredCreate.id?.href,
        "https://remote.example/activities/1",
      );
      assertEquals(receivedRaw, signed);
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: messageId,
          baseUrl: "https://example.com",
          activity: signed,
          normalizedActivity,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(receivedCount, 1);
    },
  );

  await t.step(
    "cached normalizedActivity is rechecked for unsafe JSON-LD keywords",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let receivedCount = 0;
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          receivedCount++;
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/unsafe-normalized-cache",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/unsafe-normalized-cache",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from unsafe normalized cache",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const normalizedActivity = await compactJsonLd(
        signed,
        mockDocumentLoader,
      );
      const tamperedNormalizedActivity = {
        ...(normalizedActivity as Record<string, unknown>),
        signature: {
          ...((normalizedActivity as { signature: Record<string, unknown> })
            .signature),
          "@included": [
            {
              id: "https://remote.example/activities/inside-signature",
              type: "Undo",
            },
          ],
        },
      };
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: signed,
          normalizedActivity: tamperedNormalizedActivity,
          ldSignatureVerified: false,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(receivedCount, 0);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "old queued LDS inbox messages without normalizedActivity still work",
    async () => {
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const kv = new MemoryKvStore();
      let received: Create | null = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoader: restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (_ctx, activity) => {
          received = activity;
        });
      const compacted = await compactJsonLd(
        await signJsonLd(
          {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "https://remote.example/activities/legacy",
            type: "Create",
            actor: "https://remote.example/users/alice",
            object: {
              id: "https://remote.example/notes/legacy",
              type: "Note",
              attributedTo: "https://remote.example/users/alice",
              content: "Hello from legacy queue",
            },
          },
          rsaPrivateKey3,
          rsaPublicKey3.id!,
          { contextLoader: mockDocumentLoader },
        ),
        restrictiveContextLoader,
      );
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: compacted,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assert(received != null);
      assertEquals(
        (received as Create).id?.href,
        "https://remote.example/activities/legacy",
      );
    },
  );

  await t.step(
    "queued signature-bearing non-LDS inbox messages keep parse-time normalization contexts",
    async () => {
      const signingContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1" ||
          url === "https://w3id.org/security/v1" ||
          url === "https://w3id.org/security/data-integrity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const processingContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://w3id.org/identity/v1" ||
          url === "https://w3id.org/security/v1" ||
          url === "https://w3id.org/security/data-integrity/v1"
        ) {
          throw new Error(
            "queued non-LDS signed payloads should parse with the normalization loader's built-in signature contexts",
          );
        }
        return await signingContextLoader(resource);
      };
      const kv = new MemoryKvStore();
      let received: Create | null = null;
      let receivedRaw: unknown = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoader: processingContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (ctx, activity) => {
          receivedRaw = (ctx as unknown as { activity: unknown }).activity;
          received = activity;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://w3id.org/security/v1",
          ],
          id: "https://remote.example/activities/non-lds-queued-signature",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/non-lds-queued-signature",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from non-LDS queued signature",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: signingContextLoader },
      );
      const signedPayload = signed as Record<string, unknown>;
      assert(
        Array.isArray(signedPayload["@context"]) &&
          signedPayload["@context"].includes("https://w3id.org/security/v1"),
      );
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: signed,
          ldSignatureVerified: false,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      if (received == null) throw new Error("Inbox activity not delivered.");
      const delivered = received as Create;
      assertEquals(
        delivered.id?.href,
        "https://remote.example/activities/non-lds-queued-signature",
      );
      assertEquals(receivedRaw, signed);
    },
  );

  await t.step(
    "queued signature-bearing non-LDS inbox messages reuse normalizedActivity for custom contexts",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const sourceContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      };
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const kv = new MemoryKvStore();
      let received: Create | null = null;
      let receivedRaw: unknown = null;
      const federation = new FederationImpl<void>({
        kv,
        contextLoader: restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, (ctx, activity) => {
          receivedRaw = (ctx as unknown as { activity: unknown }).activity;
          received = activity;
        });
      const unsignedBody = {
        "@context": [
          remoteContextUrl,
          "https://www.w3.org/ns/activitystreams",
          "https://w3id.org/security/v1",
        ],
        id: "https://remote.example/activities/non-lds-queued-custom-context",
        type: "Create",
        actor: "https://remote.example/users/alice",
        ext: "preserve-me",
        object: {
          id: "https://remote.example/notes/non-lds-queued-custom-context",
          type: "Note",
          attributedTo: "https://remote.example/users/alice",
          content: "Hello from non-LDS queued custom context",
        },
        signature: {
          type: "RsaSignature2017",
          creator: "not a url",
          created: "2024-09-12T16:50:46Z",
          signatureValue: "Zm9v",
        },
      };
      const normalizedActivity = await compactJsonLd(
        unsignedBody,
        sourceContextLoader,
      );
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: unsignedBody,
          normalizedActivity,
          ldSignatureVerified: false,
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      if (received == null) throw new Error("Inbox activity not delivered.");
      const delivered = received as Create;
      assertEquals(
        delivered.id?.href,
        "https://remote.example/activities/non-lds-queued-custom-context",
      );
      assertEquals(receivedRaw, unsignedBody);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages without normalizedActivity retry through worker error handling",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const restrictiveContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (
          url === "https://www.w3.org/ns/activitystreams" ||
          url === "https://w3id.org/identity/v1"
        ) {
          return await mockDocumentLoader(url);
        }
        throw new Error(`Unexpected context: ${url}`);
      };
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: restrictiveContextLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-raw",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-raw",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from raw legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages.length, 1);
      const retried = queuedMessages[0] as InboxMessage;
      assertEquals(retried.attempt, 1);
      assertEquals(retried.activity, inboxMessage.activity);
    },
  );

  await t.step(
    "without inbox queue retriable inbox parse failures bubble to caller",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const sourceContextLoader = async (resource: string) => {
        const url = new URL(resource).href;
        if (url === remoteContextUrl) {
          return {
            contextUrl: null,
            documentUrl: url,
            document: {
              "@context": {
                ext: "https://example.com/ext",
              },
            },
          };
        }
        return await mockDocumentLoader(url);
      };
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv: new MemoryKvStore(),
        contextLoader: async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            throw new Error(`Transient remote context failure: ${url}`);
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/manual-retry",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/manual-retry",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from manual retry queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: sourceContextLoader },
      );
      await assertRejects(
        () =>
          federation.processQueuedTask(
            undefined,
            {
              type: "inbox",
              id: crypto.randomUUID(),
              baseUrl: "https://example.com",
              activity: signed,
              started: new Date().toISOString(),
              attempt: 0,
              identifier: null,
              traceContext: {},
            } satisfies InboxMessage,
          ),
        Error,
      );
      assertEquals(errorCount, 1);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with transient InvalidUrl failures retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            const error = new Error(
              `Transient remote context failure: ${url}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url,
            };
            throw error;
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-invalid-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-invalid-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from invalid legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages.length, 1);
      const retried = queuedMessages[0] as InboxMessage;
      assertEquals(retried.attempt, 1);
      assertEquals(retried.activity, inboxMessage.activity);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with opaque context ids retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          if (resource === "app-context") {
            const error = new Error(
              `Opaque context backend is unavailable: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-malformed-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-malformed-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "app-context",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with Invalid URL TypeErrors retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          if (resource === "app:context") {
            throw new TypeError(`Invalid URL: ${resource}`);
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-typeerror-invalid-url",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-typeerror-invalid-url",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from invalid-url typeerror queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "app:context",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages.length, 1);
      const retried = queuedMessages[0] as InboxMessage;
      assertEquals(retried.attempt, 1);
      assertEquals(retried.activity, inboxMessage.activity);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with malformed absolute context refs do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          if (resource === "http:/[") {
            throw new TypeError(`Invalid URL: ${resource}`);
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id:
            "https://remote.example/activities/legacy-malformed-absolute-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id:
              "https://remote.example/notes/legacy-malformed-absolute-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed absolute context queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "http:/[",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "malformed IRI fields are permanent queued inbox parse errors",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "http://[",
            type: "Create",
            actor: "https://remote.example/users/alice",
            object: {
              id: "https://remote.example/notes/invalid-iri",
              type: "Note",
              attributedTo: "https://remote.example/users/alice",
              content: "Hello from invalid IRI queue",
            },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with network-path context ids retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          if (resource === "//cdn.example/ctx") {
            const error = new Error(
              `Network-path context backend is unavailable: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-network-path-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-network-path-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from network-path legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "//cdn.example/ctx",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with malformed network-path refs do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          if (resource === "//[") {
            const error = new Error(
              `Malformed network-path context: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id:
            "https://remote.example/activities/legacy-malformed-network-path-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id:
              "https://remote.example/notes/legacy-malformed-network-path-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed network-path legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "//[",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with malformed context URLs do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          if (resource === "not a url") {
            const error = new Error(
              `Invalid remote context URL: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/legacy-malformed-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-malformed-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "not a url",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with invalid percent escapes do not retry",
    async () => {
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          if (resource === "foo%zz") {
            const error = new Error(
              `Invalid remote context URL: ${resource}`,
            ) as Error & { details?: { code: string; url: string } };
            error.name = "jsonld.InvalidUrl";
            error.details = {
              code: "loading remote context failed",
              url: resource,
            };
            throw error;
          }
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          throw new Error(`Unexpected context: ${resource}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": "https://www.w3.org/ns/activitystreams",
          id:
            "https://remote.example/activities/legacy-malformed-percent-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          object: {
            id: "https://remote.example/notes/legacy-malformed-percent-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from malformed percent legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        { contextLoader: mockDocumentLoader },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: {
          ...signed,
          "@context": [
            "foo%zz",
            "https://www.w3.org/ns/activitystreams",
          ],
        },
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with invalid remote contexts do not retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            return {
              contextUrl: null,
              documentUrl: url,
              document: ["not", "an", "object"],
            };
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-invalid-remote-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-invalid-remote-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from invalid remote context queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with string remote contexts retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            return {
              contextUrl: null,
              documentUrl: url,
              document: "{not valid json",
            };
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-string-remote-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-string-remote-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from string remote context queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with loader TypeErrors retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            throw new TypeError(
              `Cannot initialize remote context loader: ${url}`,
            );
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-typeerror-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-typeerror-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from typeerror legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with syntax errors in remote contexts retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            const error = new Error(
              `Transient syntax failure: ${url}`,
            ) as Error & { details?: { code: string } };
            error.name = "jsonld.SyntaxError";
            error.details = { code: "loading remote context failed" };
            throw error;
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-syntax-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-syntax-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from syntax legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "legacy raw LDS inbox messages with loader RangeErrors retry",
    async () => {
      const remoteContextUrl = "https://remote.example/contexts/ext";
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      const queuedMessages: Message[] = [];
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        contextLoader: async (resource: string) => {
          const url = new URL(resource).href;
          if (
            url === "https://www.w3.org/ns/activitystreams" ||
            url === "https://w3id.org/identity/v1"
          ) {
            return await mockDocumentLoader(url);
          }
          if (url === remoteContextUrl) {
            throw new RangeError(
              `Temporary remote context cache window exceeded: ${url}`,
            );
          }
          throw new Error(`Unexpected context: ${url}`);
        },
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      const signed = await signJsonLd(
        {
          "@context": [
            remoteContextUrl,
            "https://www.w3.org/ns/activitystreams",
          ],
          id: "https://remote.example/activities/legacy-rangeerror-context",
          type: "Create",
          actor: "https://remote.example/users/alice",
          ext: "preserve-me",
          object: {
            id: "https://remote.example/notes/legacy-rangeerror-context",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Hello from rangeerror legacy queue",
          },
        },
        rsaPrivateKey3,
        rsaPublicKey3.id!,
        {
          contextLoader: async (resource: string) => {
            const url = new URL(resource).href;
            if (url === remoteContextUrl) {
              return {
                contextUrl: null,
                documentUrl: url,
                document: {
                  "@context": {
                    ext: "https://example.com/ext",
                  },
                },
              };
            }
            return await mockDocumentLoader(url);
          },
        },
      );
      const inboxMessage = {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://example.com",
        activity: signed,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage;
      await federation.processQueuedTask(undefined, inboxMessage);
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, [{ ...inboxMessage, attempt: 1 }]);
    },
  );

  await t.step(
    "permanent queued inbox parse errors do not re-enqueue poison messages",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "https://remote.example/objects/not-an-activity",
            type: "Note",
            attributedTo: "https://remote.example/users/alice",
            content: "Not an activity",
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "malformed Temporal fields are permanent queued inbox parse errors",
    async () => {
      const queuedMessages: Message[] = [];
      const queue: MessageQueue = {
        enqueue(message, _options) {
          queuedMessages.push(message);
          return Promise.resolve();
        },
        listen(_handler, _options) {
          return Promise.resolve();
        },
      };
      const kv = new MemoryKvStore();
      let errorCount = 0;
      const federation = new FederationImpl<void>({
        kv,
        queue,
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      });
      federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
        .on(Create, () => {
          throw new Error("listener should not run");
        })
        .onError(() => {
          errorCount++;
        });
      await federation.processQueuedTask(
        undefined,
        {
          type: "inbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          activity: {
            "@context": [
              "https://www.w3.org/ns/activitystreams",
              "https://w3id.org/security/data-integrity/v1",
            ],
            id: "https://remote.example/activities/invalid-proof-created",
            type: "Create",
            actor: "https://remote.example/users/alice",
            object: {
              id: "https://remote.example/notes/invalid-proof-created",
              type: "Note",
              attributedTo: "https://remote.example/users/alice",
              content: "Hello, world!",
            },
            proof: {
              type: "DataIntegrityProof",
              cryptosuite: "eddsa-jcs-2022",
              verificationMethod:
                "https://remote.example/users/alice#ed25519-key",
              proofPurpose: "assertionMethod",
              created: { "@value": "not-a-date" },
              proofValue:
                "zLaewdp4H9kqtwyrLatK4cjY5oRHwVcw4gibPSUDYDMhi4M49v8pcYk3ZB6D69dNpAPbUmY8ocuJ3m9KhKJEEg7z",
            },
          },
          started: new Date().toISOString(),
          attempt: 0,
          identifier: null,
          traceContext: {},
        } satisfies InboxMessage,
      );
      assertEquals(errorCount, 1);
      assertEquals(queuedMessages, []);
    },
  );
});

test("ContextImpl.lookupObject()", async (t) => {
  // Note that this test only checks if allowPrivateAddress option affects
  // the ContextImpl.lookupObject() method.  Other aspects of the method are
  // tested in the lookupObject() tests.

  fetchMock.spyGlobal();

  fetchMock.get("begin:https://localhost/.well-known/webfinger", {
    headers: { "Content-Type": "application/jrd+json" },
    body: {
      subject: "acct:test@localhost",
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: "https://localhost/actor",
        },
      ],
    },
  });

  fetchMock.get("https://localhost/actor", {
    headers: { "Content-Type": "application/activity+json" },
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Person",
      "id": "https://localhost/actor",
      "preferredUsername": "test",
    },
  });

  await t.step("allowPrivateAddress: true", async () => {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    const result = await ctx.lookupObject("@test@localhost");
    assertInstanceOf(result, Person);
    assertEquals(result.id, new URL("https://localhost/actor"));
    assertEquals(result.preferredUsername, "test");
  });

  await t.step("allowPrivateAddress: false", async () => {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: false,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    const result = await ctx.lookupObject("@test@localhost");
    assertEquals(result, null);
  });

  fetchMock.hardReset();
});

test("ContextImpl.sendActivity()", async (t) => {
  fetchMock.spyGlobal();

  let verified: ("http" | "ld" | "proof")[] | null = null;
  let request: Request | null = null;
  let collectionSyncHeader: string | null = null;
  fetchMock.post("https://example.com/inbox", async (cl) => {
    verified = [];
    request = cl.request!.clone() as Request;
    collectionSyncHeader = cl.request!.headers.get(
      "Collection-Synchronization",
    );
    const options = {
      async documentLoader(url: string) {
        const response = await federation.fetch(
          new Request(url),
          { contextData: undefined },
        );
        if (response.ok) {
          return {
            contextUrl: null,
            document: await response.json(),
            documentUrl: response.url,
          };
        }
        return await mockDocumentLoader(url);
      },
      contextLoader: mockDocumentLoader,
      keyCache: {
        async get(keyId: URL) {
          const ctx = federation.createContext(
            new URL("https://example.com/"),
            undefined,
          );
          const keys = await ctx.getActorKeyPairs("1");
          for (const key of keys) {
            if (key.keyId.href === keyId.href) {
              return key.cryptographicKey;
            }
            if (key.multikey.id?.href === keyId.href) {
              return key.multikey;
            }
          }
          return undefined;
        },
        async set(_keyId: URL, _key: CryptographicKey | Multikey | null) {
        },
      } satisfies KeyCache,
    };
    let json = await cl.request!.json();
    if (await verifyJsonLd(json, options)) verified.push("ld");
    json = detachSignature(json);
    let activity = await verifyObject(Activity, json, options);
    if (activity == null) {
      activity = await Activity.fromJsonLd(json, options);
    } else {
      verified.push("proof");
    }
    const key = await verifyRequest(request, options);
    if (key != null && await doesActorOwnKey(activity, key, options)) {
      verified.push("http");
    }
    if (verified.length > 0) return new Response(null, { status: 202 });
    return new Response(null, { status: 401 });
  });

  const kv = new MemoryKvStore();
  const federation = new FederationImpl<void>({
    kv,
    contextLoader: mockDocumentLoader,
  });

  federation
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "1") return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: "john",
        publicKey: keys[0].cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .setKeyPairsDispatcher((_ctx, identifier) => {
      if (identifier !== "1") return [];
      return [
        { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        {
          privateKey: ed25519PrivateKey,
          publicKey: ed25519PublicKey.publicKey!,
        },
      ];
    })
    .mapHandle((_ctx, username) => username === "john" ? "1" : null);

  federation.setFollowersDispatcher(
    "/users/{identifier}/followers",
    () => ({
      items: [
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
      ],
    }),
  );

  await t.step("success", async () => {
    const activity = new Create({
      actor: new URL("https://example.com/person"),
    });
    const ctx = new ContextImpl({
      data: undefined,
      federation,
      url: new URL("https://example.com/"),
      documentLoader: fetchDocumentLoader,
      contextLoader: fetchDocumentLoader,
    });
    await ctx.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
    );
    assertEquals(verified, ["http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await ctx.sendActivity(
      [{ privateKey: rsaPrivateKey3, keyId: rsaPublicKey3.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity.clone({
        actor: new URL("https://example.com/person2"),
      }),
    );
    assertEquals(verified, ["ld", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await ctx.sendActivity(
      { identifier: "1" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity.clone({ actor: ctx.getActorUri("1") }),
    );
    assertEquals(verified, ["ld", "proof", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    verified = null;
    await ctx.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity.clone({ actor: ctx.getActorUri("1") }),
    );
    assertEquals(verified, ["ld", "proof", "http"]);
    assertInstanceOf(request, Request);
    assertEquals(request?.method, "POST");
    assertEquals(request?.url, "https://example.com/inbox");
    assertEquals(
      request?.headers.get("Content-Type"),
      "application/activity+json",
    );

    await assertRejects(() =>
      ctx.sendActivity(
        { identifier: "not-found" },
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        activity.clone({ actor: ctx.getActorUri("1") }),
      )
    );

    await assertRejects(() =>
      ctx.sendActivity(
        { username: "not-found" },
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        activity.clone({ actor: ctx.getActorUri("1") }),
      )
    );
  });

  const queue: MessageQueue & { messages: Message[]; clear(): void } = {
    messages: [],
    enqueue(message) {
      this.messages.push(message);
      return Promise.resolve();
    },
    async listen() {
    },
    clear() {
      while (this.messages.length > 0) this.messages.shift();
    },
  };
  const federation2 = new FederationImpl<void>({
    kv,
    contextLoader: mockDocumentLoader,
    queue,
  });
  federation2
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "john") return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: "john",
        publicKey: keys[0].cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .setKeyPairsDispatcher((_ctx, identifier) => {
      if (identifier !== "john") return [];
      return [
        { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        {
          privateKey: ed25519PrivateKey,
          publicKey: ed25519PublicKey.publicKey!,
        },
      ];
    });
  const ctx2 = new ContextImpl({
    data: undefined,
    federation: federation2,
    url: new URL("https://example.com/"),
    documentLoader: fetchDocumentLoader,
    contextLoader: fetchDocumentLoader,
  });

  await t.step('fanout: "force"', async () => {
    const activity = new Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force" },
    );
    assertEquals(queue.messages.length, 1);
    assert(queue.messages[0].type === "fanout");
    const fanoutMsg = queue.messages[0];
    assertEquals(fanoutMsg.activityId, "https://example.com/activity/1");
    assertEquals(
      fanoutMsg.activityType,
      "https://www.w3.org/ns/activitystreams#Create",
    );
    assertEquals(fanoutMsg.baseUrl, "https://example.com");
    assertEquals(fanoutMsg.collectionSync, undefined);
    assertEquals(fanoutMsg.inboxes, {
      "https://example.com/inbox": {
        actorIds: ["https://example.com/recipient"],
        sharedInbox: false,
      },
    });
    // Regression test for <https://github.com/fedify-dev/fedify/issues/663>:
    // The activity in the fanout message should be pre-signed with OIP before
    // fanout, and the proof must reference the Multikey ID (#multikey-N),
    // not the CryptographicKey ID (#main-key or #key-N):
    const signedActivity = await Create.fromJsonLd(fanoutMsg.activity, {
      contextLoader: fetchDocumentLoader,
      documentLoader: fetchDocumentLoader,
    });
    assertEquals(signedActivity.id?.href, "https://example.com/activity/1");
    let proofCount = 0;
    for await (
      const proof of signedActivity.getProofs({
        contextLoader: fetchDocumentLoader,
      })
    ) {
      assertEquals(
        proof.verificationMethodId?.href,
        "https://example.com/john#multikey-2",
      );
      proofCount++;
    }
    assertEquals(proofCount, 1);
  });

  queue.clear();

  await t.step('fanout: "skip"', async () => {
    const activity = new Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "skip" },
    );
    assertEquals(queue.messages, [
      {
        ...queue.messages[0],
        type: "outbox",
      },
    ]);
  });

  queue.clear();

  await t.step('fanout: "auto"', async () => {
    const activity = new Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "auto" },
    );
    assertEquals(queue.messages, [
      {
        ...queue.messages[0],
        type: "outbox",
      },
    ]);

    queue.clear();
    await ctx2.sendActivity(
      { username: "john" },
      [
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        {
          id: new URL("https://example2.com/recipient"),
          inboxId: new URL("https://example2.com/inbox"),
        },
        {
          id: new URL("https://example3.com/recipient"),
          inboxId: new URL("https://example3.com/inbox"),
        },
        {
          id: new URL("https://example4.com/recipient"),
          inboxId: new URL("https://example4.com/inbox"),
        },
        {
          id: new URL("https://example5.com/recipient"),
          inboxId: new URL("https://example5.com/inbox"),
        },
      ],
      activity,
      { fanout: "auto" },
    );
    assertEquals(queue.messages, [
      {
        ...queue.messages[0],
        type: "fanout",
      },
    ]);
  });

  await t.step(
    "fanout: fanoutQueue.enqueue() is awaited before sendActivity() returns",
    async () => {
      // Regression test for <https://github.com/fedify-dev/fedify/issues/661>.
      // The fanout branch of sendActivityInternal() must await
      // fanoutQueue.enqueue() so that the message is guaranteed to be
      // enqueued before sendActivity() returns.  On runtimes like Cloudflare
      // Workers that may terminate an isolate as soon as the response is sent,
      // a floating (non-awaited) enqueue() promise can be silently dropped,
      // causing fanout messages to be lost.
      //
      // This test uses a queue whose enqueue() resolves only after a
      // macro-task delay (setTimeout 0).  If enqueue() is not awaited,
      // sendActivity() will return before the message is recorded, and the
      // assertion below will fail.
      const asyncEnqueued: Message[] = [];
      const asyncQueue: MessageQueue = {
        enqueue(message: Message): Promise<void> {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              asyncEnqueued.push(message);
              resolve();
            }, 0);
          });
        },
        async listen(): Promise<void> {},
      };
      const fed = new FederationImpl<void>({
        kv,
        contextLoader: mockDocumentLoader,
        queue: asyncQueue,
        manuallyStartQueue: true,
      });
      fed
        .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
          if (identifier !== "john") return null;
          const keys = await ctx.getActorKeyPairs(identifier);
          return new Person({
            id: ctx.getActorUri(identifier),
            preferredUsername: "john",
            publicKey: keys[0].cryptographicKey,
            assertionMethods: keys.map((k) => k.multikey),
          });
        })
        .setKeyPairsDispatcher((_ctx, identifier) => {
          if (identifier !== "john") return [];
          return [
            { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
            {
              privateKey: ed25519PrivateKey,
              publicKey: ed25519PublicKey.publicKey!,
            },
          ];
        });
      const ctx3 = new ContextImpl({
        data: undefined,
        federation: fed,
        url: new URL("https://example.com/"),
        documentLoader: fetchDocumentLoader,
        contextLoader: fetchDocumentLoader,
      });
      const activity = new Create({
        id: new URL("https://example.com/activity/1"),
        actor: new URL("https://example.com/person"),
      });
      await ctx3.sendActivity(
        { username: "john" },
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
        activity,
        { fanout: "force" },
      );
      assertEquals(
        asyncEnqueued.length,
        1,
        "fanoutQueue.enqueue() must be awaited before sendActivity() returns",
      );
    },
  );

  collectionSyncHeader = null;

  await t.step("followers collection without syncCollection", async () => {
    const ctx = new ContextImpl({
      data: undefined,
      federation,
      url: new URL("https://example.com/"),
      documentLoader: fetchDocumentLoader,
      contextLoader: fetchDocumentLoader,
    });

    const activity = new Create({
      id: new URL("https://example.com/activity/1"),
      actor: ctx.getActorUri("1"),
      to: ctx.getFollowersUri("1"),
    });

    await ctx.sendActivity({ identifier: "1" }, "followers", activity);

    assertEquals(collectionSyncHeader, null);
  });

  collectionSyncHeader = null;

  await t.step("followers collection with syncCollection", async () => {
    const ctx = new ContextImpl({
      data: undefined,
      federation,
      url: new URL("https://example.com/"),
      documentLoader: fetchDocumentLoader,
      contextLoader: fetchDocumentLoader,
    });

    const activity = new Create({
      id: new URL("https://example.com/activity/2"),
      actor: ctx.getActorUri("1"),
      to: ctx.getFollowersUri("1"),
    });

    await ctx.sendActivity(
      { identifier: "1" },
      "followers",
      activity,
      { syncCollection: true, preferSharedInbox: true },
    );

    assertNotEquals(collectionSyncHeader, null);
  });

  fetchMock.hardReset();
});

test({
  name: "ContextImpl.routeActivity()",
  permissions: { env: true, read: true },
  async fn() {
    const federation = new FederationImpl({
      kv: new MemoryKvStore(),
    });

    const activities: [string | null, Activity][] = [];
    federation
      .setInboxListeners("/u/{identifier}/i", "/i")
      .on(Offer, (ctx, offer) => {
        activities.push([ctx.recipient, offer]);
      });

    const ctx = new ContextImpl({
      url: new URL("https://example.com/"),
      federation,
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: fetchDocumentLoader,
    });

    // Unsigned & non-dereferenceable activity
    assertFalse(
      await ctx.routeActivity(
        null,
        new Offer({
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, []);

    // Signed activity without recipient (shared inbox)
    const signedOffer = await signObject(
      new Offer({
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, signedOffer));
    assertEquals(activities, [[null, signedOffer]]);

    // Signed activity with recipient (personal inbox)
    const signedInvite = await signObject(
      new Invite({
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity("id", signedInvite));
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 404
    assertFalse(
      await ctx.routeActivity(
        null,
        new Create({
          id: new URL("https://example.com/not-found"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but not an Activity
    assertFalse(
      await ctx.routeActivity(
        null,
        new Create({
          id: new URL("https://example.com/person"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but has a different id
    assertFalse(
      await ctx.routeActivity(
        null,
        new Announce({
          id: new URL("https://example.com/announce#diffrent-id"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but has no actor
    assertFalse(
      await ctx.routeActivity(
        null,
        new Announce({
          id: new URL("https://example.com/announce"),
          // Although the actor is set here, the fetched document has no actor.
          // See also fedify/testing/fixtures/example.com/announce
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but actor is cross-origin
    assertFalse(
      await ctx.routeActivity(
        null,
        new Create({
          id: new URL("https://example.com/cross-origin-actor"),
          actor: new URL("https://cross-origin.com/actor"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but no inbox listener corresponds
    assert(
      await ctx.routeActivity(
        null,
        new Create({
          id: new URL("https://example.com/create"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200
    assert(
      await ctx.routeActivity(
        null,
        new Invite({
          id: new URL("https://example.com/invite"),
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(
      activities,
      [
        [null, signedOffer],
        ["id", signedInvite],
        [
          null,
          new Invite({
            id: new URL("https://example.com/invite"),
            actor: new URL("https://example.com/person"),
            object: new URL("https://example.com/object"),
          }),
        ],
      ],
    );
  },
});

test("ContextImpl.routeActivity() marks queued signed activities as non-LDS", async () => {
  let queuedMessage: InboxMessage | null = null;
  const queue: MessageQueue = {
    enqueue(message) {
      queuedMessage = message as InboxMessage;
      return Promise.resolve();
    },
    async listen() {
    },
  };
  const federation = new FederationImpl({
    kv: new MemoryKvStore(),
    queue,
  });
  federation
    .setInboxListeners("/u/{identifier}/i", "/i")
    .on(Offer, () => {
      throw new Error("listener should not run for queued routeActivity");
    });

  const ctx = new ContextImpl({
    url: new URL("https://example.com/"),
    federation,
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: fetchDocumentLoader,
  });

  const signedOffer = await signObject(
    new Offer({
      actor: new URL("https://example.com/person2"),
    }),
    ed25519PrivateKey,
    ed25519Multikey.id!,
  );
  assert(await ctx.routeActivity(null, signedOffer));
  if (queuedMessage == null) throw new Error("Inbox message not queued.");
  const inboxMessage = queuedMessage as InboxMessage;
  assertEquals(inboxMessage.ldSignatureVerified, false);
  assertEquals(inboxMessage.normalizedActivity, undefined);
});

test("ContextImpl.getCollectionUri()", () => {
  const federation = new FederationImpl({ kv: new MemoryKvStore() });
  const base = "https://example.com";

  const ctx = new ContextImpl({
    url: new URL(base),
    federation,
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: fetchDocumentLoader,
  });

  const values = { id: "123" };
  const dispatcher = (_ctx: unknown, _values: { id: string }) => ({
    items: [],
  });
  let url: URL;
  // Registered with string name
  const strName = "registered";

  federation.setCollectionDispatcher(
    strName,
    Object,
    "/string-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(strName, values);
  assertEquals(url.href, `${base}/string-route/123`);

  // Registered with unnamed symbol name
  const unnamedSymName = Symbol(strName);
  federation.setCollectionDispatcher(
    unnamedSymName,
    Object,
    "/symbol-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(unnamedSymName, values);
  assertEquals(url.href, `${base}/symbol-route/123`);

  // Registered with named symbol name
  const namedSymName = Symbol.for(strName);
  federation.setCollectionDispatcher(
    namedSymName,
    Object,
    "/named-symbol-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(namedSymName, values);
  assertEquals(url.href, `${base}/named-symbol-route/123`);

  // Not registered
  const notReg = "not-registered";
  assertThrows(() => ctx.getCollectionUri(notReg, values));
  assertThrows(() => ctx.getCollectionUri(Symbol(notReg), values));
  assertThrows(() => ctx.getCollectionUri(Symbol.for(notReg), values));
});

test("InboxContextImpl.forwardActivity()", async (t) => {
  fetchMock.spyGlobal();

  let verified: ("http" | "ld" | "proof")[] | null = null;
  let request: Request | null = null;
  fetchMock.post("https://example.com/inbox", async (cl) => {
    verified = [];
    request = cl.request!.clone() as Request;
    const options = {
      documentLoader: mockDocumentLoader,
      contextLoader: mockDocumentLoader,
    };
    let json = await cl.request!.json();
    if (await verifyJsonLd(json, options)) verified.push("ld");
    json = detachSignature(json);
    let activity = await verifyObject(Activity, json, options);
    if (activity == null) {
      activity = await Activity.fromJsonLd(json, options);
    } else {
      verified.push("proof");
    }
    const key = await verifyRequest(request, options);
    if (key != null && await doesActorOwnKey(activity, key, options)) {
      verified.push("http");
    }
    if (verified.length > 0) return new Response(null, { status: 202 });
    return new Response(null, { status: 401 });
  });

  const kv = new MemoryKvStore();
  const federation = new FederationImpl<void>({
    kv,
    contextLoader: mockDocumentLoader,
  });

  await t.step("skip", async () => {
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person2",
    };
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: fetchDocumentLoader,
        contextLoader: fetchDocumentLoader,
      },
    );
    await ctx.forwardActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      { skipIfUnsigned: true },
    );
    assertEquals(verified, null);
  });

  await t.step("unsigned", async () => {
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "id": "https://example.com/activity",
      "actor": "https://example.com/person2",
    };
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: fetchDocumentLoader,
        contextLoader: fetchDocumentLoader,
      },
    );
    await assertRejects(() =>
      ctx.forwardActivity(
        [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
        {
          id: new URL("https://example.com/recipient"),
          inboxId: new URL("https://example.com/inbox"),
        },
      )
    );
    assertEquals(verified, []);
  });

  await t.step("Object Integrity Proofs", async () => {
    const activity = await signObject(
      new Create({
        id: new URL("https://example.com/activity"),
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
      { contextLoader: mockDocumentLoader, documentLoader: mockDocumentLoader },
    );
    const ctx = new InboxContextImpl(
      null,
      await activity.toJsonLd({ contextLoader: mockDocumentLoader }),
      activity.id?.href,
      getTypeId(activity).href,
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: fetchDocumentLoader,
        contextLoader: fetchDocumentLoader,
      },
    );
    await ctx.forwardActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      { skipIfUnsigned: true },
    );
    assertEquals(verified, ["proof"]);
  });

  await t.step("LD Signatures", async () => {
    const activity = await signJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        "type": "Create",
        "id": "https://example.com/activity",
        "actor": "https://example.com/person2",
      },
      rsaPrivateKey3,
      rsaPublicKey3.id!,
      { contextLoader: mockDocumentLoader },
    );
    const ctx = new InboxContextImpl(
      null,
      activity,
      "https://example.com/activity",
      "https://www.w3.org/ns/activitystreams#Create",
      {
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: fetchDocumentLoader,
        contextLoader: fetchDocumentLoader,
      },
    );
    await ctx.forwardActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      { skipIfUnsigned: true },
    );
    assertEquals(verified, ["ld"]);
  });

  fetchMock.hardReset();
});

test("KvSpecDeterminer", async (t) => {
  await t.step("should use default spec when not found in KV", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;

    // Test with default rfc9421
    const determiner = new KvSpecDeterminer(kv, prefix);
    const spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "rfc9421");
  });

  await t.step("should use custom default spec", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;

    // Test with custom default spec
    const determiner = new KvSpecDeterminer(
      kv,
      prefix,
      "draft-cavage-http-signatures-12",
    );
    const spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "draft-cavage-http-signatures-12");
  });

  await t.step("should remember and retrieve spec from KV", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;
    const determiner = new KvSpecDeterminer(kv, prefix);

    // Remember a spec for a specific origin
    await determiner.rememberSpec(
      "example.com",
      "draft-cavage-http-signatures-12",
    );

    // Should retrieve the remembered spec
    const spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "draft-cavage-http-signatures-12");

    // Different origin should still use default
    const defaultSpec = await determiner.determineSpec("other.com");
    assertEquals(defaultSpec, "rfc9421");
  });

  await t.step("should override remembered spec", async () => {
    const kv = new MemoryKvStore();
    const prefix = ["test", "spec"] as const;
    const determiner = new KvSpecDeterminer(kv, prefix);

    // Remember initial spec
    await determiner.rememberSpec(
      "example.com",
      "draft-cavage-http-signatures-12",
    );
    let spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "draft-cavage-http-signatures-12");

    // Override with new spec
    await determiner.rememberSpec("example.com", "rfc9421");
    spec = await determiner.determineSpec("example.com");
    assertEquals(spec, "rfc9421");
  });
});
