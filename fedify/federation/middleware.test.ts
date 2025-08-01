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
import { detachSignature, signJsonLd, verifyJsonLd } from "../sig/ld.ts";
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
              id: new URL("https://example.com/users/handle#main-key"),
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
              id: new URL("https://example.com/users/handle#key-2"),
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
              if (key.publicKey.algorithm.name === "Ed25519") {
                return key.multikey;
              } else return key.cryptographicKey;
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
    assertEquals(queue.messages, [
      {
        id: queue.messages[0].id,
        type: "fanout",
        activity: await activity.toJsonLd({
          format: "compact",
          contextLoader: fetchDocumentLoader,
        }),
        activityId: "https://example.com/activity/1",
        activityType: "https://www.w3.org/ns/activitystreams#Create",
        baseUrl: "https://example.com",
        collectionSync: undefined,
        inboxes: {
          "https://example.com/inbox": {
            actorIds: [
              "https://example.com/recipient",
            ],
            sharedInbox: false,
          },
        },
        keys: queue.messages[0].type === "fanout" ? queue.messages[0].keys : [],
        traceContext: {},
      },
    ]);
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
