import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import type { TracerProvider } from "@opentelemetry/api";
import * as vocab from "@fedify/vocab";
import { Create, getTypeId, lookupObject, Offer, Person } from "@fedify/vocab";
import { configure, type LogRecord, reset } from "@logtape/logtape";
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
import dns from "node:dns/promises";
import createFixture from "../../../fixture/src/fixtures/example.com/create.json" with {
  type: "json",
};
import personFixture from "../../../fixture/src/fixtures/example.com/person.json" with {
  type: "json",
};
import person2Fixture from "../../../fixture/src/fixtures/example.com/person2.json" with {
  type: "json",
};
import { signRequest, verifyRequest } from "../sig/http.ts";
import type { KeyCache } from "../sig/key.ts";
import {
  attachSignature,
  compactJsonLd,
  detachSignature,
  signJsonLd,
  verifyJsonLd,
} from "../sig/ld.ts";
import { doesActorOwnKey } from "../sig/owner.ts";
import { signObject, verifyObject } from "../sig/proof.ts";
import {
  ed25519Multikey,
  ed25519PrivateKey,
  ed25519PublicKey,
  rsaPrivateKey2,
  rsaPrivateKey3,
  rsaPublicKey2,
  rsaPublicKey3,
} from "../testing/keys.ts";
import { FetchError, getDocumentLoader, UrlError } from "@fedify/vocab-runtime";
import { getAuthenticatedDocumentLoader } from "../utils/docloader.ts";

const documentLoader = getDocumentLoader({ allowPrivateAddress: true });
import type { Context } from "./context.ts";
import { type KvKey, type KvStoreSetOptions, MemoryKvStore } from "./kv.ts";
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
import { SendActivityError } from "./send.ts";

test("createFederation()", async (t) => {
  const kv = new MemoryKvStore();

  await t.step("allowPrivateAddress", () => {
    assertThrows(() =>
      createFederation<number>({
        kv,
        contextLoaderFactory: () => mockDocumentLoader,
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

    fetchMock.spyGlobal();

    fetchMock.get("https://example.com/auth-check", async (cl) => {
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
      const rejectingLoader = (_url: string) =>
        Promise.reject(new Error("Not found"));

      const federation = createFederation<number>({
        kv,
        documentLoaderFactory: () => rejectingLoader,
        contextLoaderFactory: () => mockDocumentLoader,
        authenticatedDocumentLoaderFactory: (identity) =>
          getAuthenticatedDocumentLoader(identity, {
            allowPrivateAddress: true,
          }),
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
      assertStrictEquals(ctx.documentLoader, rejectingLoader);
      assertStrictEquals(ctx.contextLoader, mockDocumentLoader);
      assertStrictEquals(ctx.federation, federation);
      assertThrows(() => ctx.getNodeInfoUri(), RouterError);
      assertThrows(() => ctx.getActorUri("handle"), RouterError);
      assertThrows(
        () => ctx.getObjectUri(vocab.Note, { handle: "handle", id: "id" }),
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
        () =>
          ctx.sendActivity({ identifier: "handle" }, [], new vocab.Create({})),
        Error,
        "No actor key pairs dispatcher registered",
      );

      federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
        software: {
          name: "Example",
          version: "1.2.3",
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
        .setActorDispatcher("/users/{identifier}", () => new vocab.Person({}))
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
        { type: "actor", identifier: "handle" },
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
            multikey: new vocab.Multikey({
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
            multikey: new vocab.Multikey({
              id: new URL("https://example.com/users/handle#multikey-2"),
              controller: new URL("https://example.com/users/handle"),
              publicKey: ed25519PublicKey.publicKey!,
            }),
          },
        ],
      );
      const loader = await ctx.getDocumentLoader({ identifier: "handle" });
      assertEquals(await loader("https://example.com/auth-check"), {
        contextUrl: null,
        documentUrl: "https://example.com/auth-check",
        document: true,
      });
      const loader2 = await ctx.getDocumentLoader({ username: "HANDLE" });
      assertEquals(await loader2("https://example.com/auth-check"), {
        contextUrl: null,
        documentUrl: "https://example.com/auth-check",
        document: true,
      });
      const loader3 = ctx.getDocumentLoader({
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      });
      assertEquals(await loader3("https://example.com/auth-check"), {
        contextUrl: null,
        documentUrl: "https://example.com/auth-check",
        document: true,
      });
      // The WebFinger fallback must not reach the network:
      assertEquals(
        await withDnsLookup(
          () => Promise.reject(new Error("Resolver unavailable")),
          () => ctx.lookupObject("https://example.com/object"),
        ),
        null,
      );
      await assertRejects(
        () =>
          ctx.sendActivity({ identifier: "handle" }, [], new vocab.Create({})),
        TypeError,
        "The activity to send must have at least one actor property.",
      );
      await ctx.sendActivity(
        { identifier: "handle" },
        [],
        new vocab.Create({
          actor: new URL("https://example.com/users/handle"),
        }),
      );

      fetchMock.get(
        "https://example.com/object",
        () =>
          new Response(
            JSON.stringify({
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Object",
              id: "https://example.com/object",
              name: "Fetched object",
            }),
            { headers: { "Content-Type": "application/activity+json" } },
          ),
      );

      const federation2 = createFederation<number>({
        kv,
        documentLoaderFactory: () => documentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      const ctx2 = federation2.createContext(
        new URL("https://example.com/"),
        123,
      );
      assertEquals(
        await ctx2.lookupObject("https://example.com/object"),
        new vocab.Object({
          id: new URL("https://example.com/object"),
          name: "Fetched object",
        }),
      );

      federation.setObjectDispatcher(
        vocab.Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new vocab.Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      ctx = federation.createContext(new URL("https://example.com/"), 123);
      assertEquals(
        ctx.getObjectUri(vocab.Note, { identifier: "john", id: "123" }),
        new URL("https://example.com/users/john/notes/123"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/john/notes/123")),
        {
          type: "object",
          class: vocab.Note,
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
        { type: "inbox", identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com/users/handle/inbox")),
        { type: "inbox", identifier: "handle" },
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
        { type: "outbox", identifier: "handle" },
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
        { type: "following", identifier: "handle" },
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
        { type: "followers", identifier: "handle" },
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
        { type: "liked", identifier: "handle" },
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
        { type: "featured", identifier: "handle" },
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
        { type: "featuredTags", identifier: "handle" },
      );
      assertEquals(ctx.parseUri(null), null);
    });

    await t.step("Context with origin", () => {
      const federation = createFederation<void>({
        kv,
        origin: "https://ap.example.com",
        documentLoaderFactory: () => mockDocumentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
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
          version: "1.2.3",
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
        () => new vocab.Person({}),
      );
      assertEquals(
        ctx.getActorUri("handle"),
        new URL("https://ap.example.com/users/handle"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle")),
        { type: "actor", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle")),
        { type: "actor", identifier: "handle" },
      );

      federation.setObjectDispatcher(
        vocab.Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new vocab.Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      assertEquals(
        ctx.getObjectUri(vocab.Note, { identifier: "john", id: "123" }),
        new URL("https://ap.example.com/users/john/notes/123"),
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/john/notes/123")),
        {
          type: "object",
          class: vocab.Note,
          typeId: new URL("https://www.w3.org/ns/activitystreams#Note"),
          values: { identifier: "john", id: "123" },
        },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/john/notes/123")),
        {
          type: "object",
          class: vocab.Note,
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
        { type: "inbox", identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/inbox")),
        { type: "inbox", identifier: undefined },
      );
      assertEquals(
        ctx.parseUri(new URL("https://ap.example.com/users/handle/inbox")),
        { type: "inbox", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/inbox")),
        { type: "inbox", identifier: "handle" },
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
        { type: "outbox", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/outbox")),
        { type: "outbox", identifier: "handle" },
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
        { type: "following", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(
          new URL("https://example.com:1234/users/handle/following"),
        ),
        { type: "following", identifier: "handle" },
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
        { type: "followers", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(
          new URL("https://example.com:1234/users/handle/followers"),
        ),
        { type: "followers", identifier: "handle" },
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
        { type: "liked", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/liked")),
        { type: "liked", identifier: "handle" },
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
        { type: "featured", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/featured")),
        { type: "featured", identifier: "handle" },
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
        { type: "featuredTags", identifier: "handle" },
      );
      assertEquals(
        ctx.parseUri(new URL("https://example.com:1234/users/handle/tags")),
        { type: "featuredTags", identifier: "handle" },
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

    // Bun connects to the resolved address instead of the hostname, so these
    // routes match only the path; the lookup is stubbed in the step below:
    fetchMock.get("path:/.well-known/nodeinfo", (cl) => {
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

    fetchMock.get("path:/nodeinfo/2.1", (cl) => {
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
      const lookupExample = () =>
        Promise.resolve([{ address: "93.184.215.14", family: 4 }]);
      const nodeInfo = await withDnsLookup(
        lookupExample,
        () => ctx.lookupNodeInfo("https://example.com/"),
      );
      assertEquals(nodeInfo, {
        software: {
          name: "foo",
          version: "1.2.3",
        },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      });

      const rawNodeInfo = await withDnsLookup(
        lookupExample,
        () => ctx.lookupNodeInfo("https://example.com/", { parse: "none" }),
      );
      assertEquals(rawNodeInfo, {
        software: { name: "foo", version: "1.2.3" },
        protocols: ["activitypub", "diaspora"],
        usage: { users: {}, localPosts: 123, localComments: 456 },
      });
    });

    await t.step("RequestContext", async () => {
      const federation = createFederation<number>({
        kv,
        documentLoaderFactory: () => mockDocumentLoader,
      });
      const req = new Request("https://example.com/", {
        headers: { "accept": "application/ld+json" },
      });
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
        () => ctx.getObject(vocab.Note, { handle: "someone", id: "123" }),
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
        new Request("https://example.com/", {
          headers: { "accept": "application/ld+json" },
        }),
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
        new Request("https://example.com/", {
          headers: { "accept": "application/ld+json" },
        }),
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
        (_ctx, identifier) =>
          new vocab.Person({ preferredUsername: identifier }),
      );
      const ctx2 = federation.createContext(req, 789);
      assertEquals(ctx2.request, req);
      assertEquals(ctx2.url, new URL("https://example.com/"));
      assertEquals(ctx2.data, 789);
      assertEquals(
        await ctx2.getActor("john"),
        new vocab.Person({ preferredUsername: "john" }),
      );

      federation.setObjectDispatcher(
        vocab.Note,
        "/users/{identifier}/notes/{id}",
        (_ctx, values) => {
          return new vocab.Note({
            summary: `Note ${values.id} by ${values.identifier}`,
          });
        },
      );
      const ctx3 = federation.createContext(req, 123);
      assertEquals(ctx3.request, req);
      assertEquals(ctx3.url, new URL("https://example.com/"));
      assertEquals(ctx3.data, 123);
      assertEquals(
        await ctx2.getObject(vocab.Note, { identifier: "john", id: "123" }),
        new vocab.Note({ summary: "Note 123 by john" }),
      );
    });

    await t.step("RequestContext.clone()", () => {
      const federation = createFederation<number>({
        kv,
      });
      const req = new Request("https://example.com/", {
        headers: { "accept": "application/ld+json" },
      });
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

test("RequestContext signature checks", async (t) => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  const keyId = rsaPublicKey3.id!.href;
  const ownerId = rsaPublicKey3.ownerId!.href;
  const request = await signRequest(
    new Request("https://example.com/"),
    rsaPrivateKey3,
    rsaPublicKey3.id!,
  );

  function setup(options: {
    gate?: Promise<void>;
    load?: DocumentLoader;
    tracerProvider?: TracerProvider;
    request?: Request;
  } = {}) {
    const loads = { key: 0, owner: 0 };
    const loader: DocumentLoader = async (url, loaderOptions) => {
      if (url === keyId) loads.key++;
      else if (url === ownerId) loads.owner++;
      await options.gate;
      return await (options.load ?? mockDocumentLoader)(url, loaderOptions);
    };
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => loader,
      contextLoaderFactory: () => mockDocumentLoader,
      tracerProvider: options.tracerProvider ?? tracerProvider,
    });
    const ctx = federation.createContext(
      options.request ?? new Request(request),
      undefined,
    );
    return { ctx, loads, loader, federation };
  }

  try {
    for (const mode of ["keys", "owners", "warm owners", "mixed"] as const) {
      await t.step(`coalesces ${mode}`, async () => {
        exporter.clear();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => release = resolve);
        const { ctx, loads, loader } = setup({ gate });
        if (mode === "warm owners") {
          release();
          assert(await ctx.getSignedKey());
        }
        const results = Promise.all(Array.from({ length: 8 }, (_, i) => {
          // Fresh option objects and explicit defaults must use the same entry.
          const options = i % 2 === 0 ? {} : {
            documentLoader: loader,
            contextLoader: ctx.contextLoader,
            tracerProvider,
          };
          return mode === "keys" || (mode === "mixed" && i % 2 === 0)
            ? ctx.getSignedKey(options)
            : ctx.getSignedKeyOwner(options);
        }));
        release();
        for (const result of await results) assert(result != null);
        assertEquals(loads, { key: 1, owner: mode === "keys" ? 0 : 1 });
        assertEquals(exporter.getSpans("http_signatures.verify").length, 1);
        assert(await ctx.getSignedKey());
        if (mode !== "keys") assert(await ctx.getSignedKeyOwner());
        assertEquals(loads, { key: 1, owner: mode === "keys" ? 0 : 1 });
      });
    }

    await t.step("memoizes null keys", async () => {
      exporter.clear();
      const { ctx, loads } = setup({
        load: () => Promise.reject(new Error("unavailable")),
      });
      for (let i = 0; i < 3; i++) {
        assertEquals(await ctx.getSignedKey(), null);
        assertEquals(await ctx.getSignedKeyOwner(), null);
      }
      assertEquals(loads, { key: 1, owner: 0 });
      assertEquals(exporter.getSpans("http_signatures.verify").length, 1);
      // Another loader must still be able to verify the same request.
      assert(await ctx.getSignedKey({ documentLoader: mockDocumentLoader }));
      assert(
        await ctx.getSignedKeyOwner({ documentLoader: mockDocumentLoader }),
      );
    });

    await t.step("memoizes unsigned requests", async () => {
      exporter.clear();
      const { ctx, loads } = setup({
        request: new Request("https://example.com/"),
      });
      for (let i = 0; i < 3; i++) {
        assertEquals(await ctx.getSignedKey(), null);
        assertEquals(await ctx.getSignedKeyOwner(), null);
      }
      assertEquals(loads, { key: 0, owner: 0 });
      assertEquals(exporter.getSpans("http_signatures.verify").length, 1);
    });

    await t.step(
      "memoizes null owners without trusting a key's owner claim",
      async () => {
        const { ctx, loads } = setup({
          load: async (url, options) =>
            url === ownerId
              ? {
                documentUrl: url,
                contextUrl: null,
                document: { ...person2Fixture, publicKey: [] },
              }
              : await mockDocumentLoader(url, options),
        });
        assert(await ctx.getSignedKey());
        const owners = await Promise.all(
          Array.from({ length: 8 }, () => ctx.getSignedKeyOwner()),
        );
        assertEquals(owners, Array(8).fill(null));
        for (let i = 0; i < 3; i++) {
          assertEquals(await ctx.getSignedKeyOwner(), null);
        }
        assertEquals(loads, { key: 1, owner: 1 });
        assert(
          await ctx.getSignedKeyOwner({ documentLoader: mockDocumentLoader }),
        );
        assert(await ctx.getSignedKeyOwner());
      },
    );

    await t.step(
      "isolates concurrent document loaders before success",
      async () => {
        const { ctx, loads } = setup();
        let otherLoads = 0;
        const otherLoader: DocumentLoader = async (url, options) => {
          otherLoads++;
          if (url === ownerId) {
            return {
              documentUrl: url,
              contextUrl: null,
              document: { ...person2Fixture, name: "Other view" },
            };
          }
          return await mockDocumentLoader(url, options);
        };
        const [first, second] = await Promise.all([
          ctx.getSignedKeyOwner(),
          ctx.getSignedKeyOwner({ documentLoader: otherLoader }),
        ]);
        assertEquals(first?.name, "Jane Doe");
        assertEquals(second?.name, "Other view");
        const cached = await ctx.getSignedKeyOwner();
        assert(cached === first || cached === second);
        assertStrictEquals(
          await ctx.getSignedKeyOwner({ documentLoader: otherLoader }),
          cached,
        );
        assertEquals(loads, { key: 1, owner: 1 });
        assertEquals(otherLoads, 2);
      },
    );

    await t.step(
      "preserves in-flight null while another loader succeeds",
      async () => {
        exporter.clear();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => release = resolve);
        const { ctx, loads } = setup({
          load: async () => {
            await gate;
            throw new TypeError("fetch failed");
          },
        });
        const failed = Promise.all([
          ctx.getSignedKey(),
          ctx.getSignedKeyOwner(),
        ]);
        const owner = await ctx.getSignedKeyOwner({
          documentLoader: mockDocumentLoader,
        });
        assert(owner);
        release();
        assertEquals(await failed, [null, null]);
        assertStrictEquals(await ctx.getSignedKeyOwner(), owner);
        assert(await ctx.getSignedKey());
        assertEquals(loads, { key: 1, owner: 0 });
        assertEquals(exporter.getSpans("http_signatures.verify").length, 2);
      },
    );

    await t.step("isolates context loaders", async () => {
      exporter.clear();
      const { ctx, loads } = setup();
      const otherContextLoader: DocumentLoader = (url, options) =>
        mockDocumentLoader(url, options);
      await Promise.all([
        ctx.getSignedKeyOwner(),
        ctx.getSignedKeyOwner({ contextLoader: otherContextLoader }),
      ]);
      assertEquals(loads, { key: 2, owner: 2 });
      assertEquals(exporter.getSpans("http_signatures.verify").length, 2);
    });

    await t.step("shares work across tracer providers", async () => {
      exporter.clear();
      const [otherProvider, otherExporter] = createTestTracerProvider();
      try {
        const { ctx, loads } = setup();
        await Promise.all([
          ctx.getSignedKeyOwner(),
          ctx.getSignedKeyOwner({ tracerProvider: otherProvider }),
          ctx.getSignedKey(),
          ctx.getSignedKey({ tracerProvider: otherProvider }),
        ]);
        assert(await ctx.getSignedKeyOwner({ tracerProvider: otherProvider }));
        assertEquals(loads, { key: 1, owner: 1 });
        assertEquals(exporter.getSpans("http_signatures.verify").length, 1);
        assertEquals(
          otherExporter.getSpans("http_signatures.verify").length,
          0,
        );
      } finally {
        await otherProvider.shutdown();
      }
    });

    await t.step(
      "reuses success with a fresh authorization loader",
      async () => {
        exporter.clear();
        const { ctx, loads } = setup();
        let freshLoads = 0;
        const freshLoader: DocumentLoader = (url, options) => {
          freshLoads++;
          return mockDocumentLoader(url, options);
        };
        const key = await ctx.getSignedKey({ documentLoader: freshLoader });
        assert(key);
        assertStrictEquals(await ctx.getSignedKey(), key);
        const owner = await ctx.getSignedKeyOwner();
        assert(owner);
        assertStrictEquals(
          await ctx.getSignedKeyOwner({ documentLoader: freshLoader }),
          owner,
        );
        assertEquals(loads, { key: 0, owner: 1 });
        assertEquals(freshLoads, 1);
        assertEquals(exporter.getSpans("http_signatures.verify").length, 1);
      },
    );

    await t.step(
      "retains a transient owner lookup failure as null",
      async () => {
        let fail = true;
        const { ctx, loads } = setup({
          load: async (url, options) => {
            if (url === ownerId && fail) throw new TypeError("fetch failed");
            return await mockDocumentLoader(url, options);
          },
        });
        assert(await ctx.getSignedKey());
        assertEquals(await ctx.getSignedKeyOwner(), null);
        fail = false;
        assertEquals(await ctx.getSignedKeyOwner(), null);
        assertEquals(loads, { key: 1, owner: 1 });
        assert(
          await ctx.getSignedKeyOwner({ documentLoader: mockDocumentLoader }),
        );
      },
    );

    await t.step(
      "rechecks an owner after another loader verifies the key",
      async () => {
        let fail = true;
        const { ctx, loads } = setup({
          load: async (url, options) => {
            if (url === keyId && fail) throw new TypeError("fetch failed");
            return await mockDocumentLoader(url, options);
          },
        });
        assertEquals(await ctx.getSignedKeyOwner(), null);
        // Negative results with the same loaders remain cached after a transient failure.
        fail = false;
        assertEquals(await ctx.getSignedKeyOwner(), null);
        assertEquals(loads, { key: 1, owner: 0 });
        assert(await ctx.getSignedKey({ documentLoader: mockDocumentLoader }));
        const owner = await ctx.getSignedKeyOwner();
        assertEquals(owner?.id?.href, ownerId);
        assertEquals(loads, { key: 1, owner: 1 });
      },
    );

    await t.step(
      "retries unexpected key rejections from a rejection handler",
      async () => {
        exporter.clear();
        const failure = new Error("transient context loader failure");
        let rejectContext = true;
        const contextLoader: DocumentLoader = async (url, options) => {
          if (rejectContext) throw failure;
          return await mockDocumentLoader(url, options);
        };
        const { ctx, loads } = setup();
        const options = { contextLoader };
        const failedKeys = Promise.allSettled([
          ctx.getSignedKey(options),
          ctx.getSignedKeyOwner(options),
          ctx.getSignedKey(options),
        ]);
        const recovery = ctx.getSignedKey(options).catch(() => {
          rejectContext = false;
          return ctx.getSignedKey(options);
        });
        for (const result of await failedKeys) {
          assertEquals(result.status, "rejected");
        }
        assert(await recovery);
        assertEquals(loads, { key: 2, owner: 0 });
        assertEquals(exporter.getSpans("http_signatures.verify").length, 2);
      },
    );

    await t.step(
      "retries owner rejections while retaining the verified key",
      async () => {
        exporter.clear();
        let rejectContext = false;
        const contextLoader: DocumentLoader = async (url, options) => {
          if (rejectContext) {
            throw new Error("transient owner context failure");
          }
          return await mockDocumentLoader(url, options);
        };
        const { ctx, loads } = setup();
        const options = { contextLoader };
        // The fragment key is served in its own actor document, so this does not fetch the owner.
        assert(await ctx.getSignedKey(options));
        assertEquals(loads, { key: 1, owner: 0 });
        rejectContext = true;
        const failures = await Promise.allSettled([
          ctx.getSignedKeyOwner(options),
          ctx.getSignedKeyOwner(options),
        ]);
        for (const result of failures) {
          assertEquals(result.status, "rejected");
        }
        assertEquals(loads, { key: 1, owner: 1 });
        rejectContext = false;
        assert(await ctx.getSignedKeyOwner(options));
        assertEquals(loads, { key: 1, owner: 2 });
        assertEquals(exporter.getSpans("http_signatures.verify").length, 1);
      },
    );

    await t.step("keeps clones and separate requests independent", async () => {
      exporter.clear();
      const { ctx, loads, federation } = setup();
      assert(await ctx.getSignedKeyOwner());
      const clone = ctx.clone(undefined);
      const separate = federation.createContext(
        new Request(request),
        undefined,
      );
      await Promise.all([
        clone.getSignedKeyOwner(),
        separate.getSignedKeyOwner(),
      ]);
      assertEquals(loads, { key: 3, owner: 3 });
      assertEquals(exporter.getSpans("http_signatures.verify").length, 3);
    });
  } finally {
    await tracerProvider.shutdown();
  }
});

test("Federation.fetch() [rfc9421] multiple POST signatures", async (t) => {
  for (const validSecond of [true, false]) {
    await t.step(
      validSecond ? "valid second signature" : "both signatures invalid",
      async () => {
        const inbox: string[] = [];
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          documentLoaderFactory: () => mockDocumentLoader,
          contextLoaderFactory: () => mockDocumentLoader,
        });
        federation.setActorDispatcher(
          "/users/{identifier}",
          (ctx, identifier) =>
            new vocab.Person({ id: ctx.getActorUri(identifier) }),
        );
        federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
          .on(vocab.Create, (_ctx, activity) => {
            inbox.push(activity.id!.href);
          });
        const signed = await signRequest(
          new Request("https://example.com/inbox", {
            method: "POST",
            headers: { "Content-Type": "application/activity+json" },
            body: JSON.stringify(createFixture),
          }),
          rsaPrivateKey2,
          rsaPublicKey2.id!,
          { spec: "rfc9421" },
        );
        const input = signed.headers.get("Signature-Input")!;
        const signature = signed.headers.get("Signature")!;
        signed.headers.set(
          "Signature-Input",
          `${input}, ${input.replace(/^sig1=/, "sig2=")}`,
        );
        signed.headers.set(
          "Signature",
          `sig1=:AAAAAA==:, ${
            validSecond
              ? signature.replace(/^sig1=/, "sig2=")
              : "sig2=:AAAAAA==:"
          }`,
        );
        const response = await federation.fetch(signed, {
          contextData: undefined,
        });
        assertEquals(response.status, validSecond ? 202 : 401);
        assertEquals(inbox, validSecond ? [createFixture.id] : []);
      },
    );
  }
});

test("Federation.fetch()", async (t) => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/key2", {
    headers: { "Content-Type": "application/activity+json" },
    body: await rsaPublicKey2.toJsonLd({ contextLoader: mockDocumentLoader }),
  });

  fetchMock.get("begin:https://example.com/person", {
    headers: { "Content-Type": "application/activity+json" },
    body: personFixture,
  });

  const createTestContext = () => {
    const kv = new MemoryKvStore();
    const inbox: string[] = [];
    const dispatches: string[] = [];

    const federation = createFederation<void>({
      kv,
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity, {
          allowPrivateAddress: true,
        });
        return (url: string) => {
          const urlObj = new URL(url);
          if (urlObj.host === "example.com") return docLoader(url);
          return mockDocumentLoader(url);
        };
      },
    });

    federation.setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) => {
        dispatches.push(identifier);
        return new vocab.Person({
          id: ctx.getActorUri(identifier),
          inbox: ctx.getInboxUri(identifier),
          preferredUsername: identifier,
        });
      },
    )
      .setKeyPairsDispatcher(() => {
        return [
          { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        ];
      });

    federation.setInboxDispatcher("/users/{identifier}/inbox", () => {
      return { items: [] };
    });

    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, (_ctx, activity) => {
        inbox.push(activity.id!.toString());
        return;
      });

    return {
      federation,
      inbox,
      dispatches,
    };
  };

  await t.step("GET without accepts header", async () => {
    const { federation, dispatches } = createTestContext();

    // Should not call dispatcher on GET:
    const response = await federation.fetch(
      new Request("https://example.com/users/actor", {
        method: "GET",
      }),
      { contextData: undefined },
    );

    assertEquals(dispatches, []);
    assertEquals(response.status, 406);
  });

  await t.step("POST with application/json", async () => {
    const { federation, inbox } = createTestContext();

    const request = await signRequest(
      new Request("https://example.com/users/json/inbox", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createFixture),
      }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
    );

    const response = await federation.fetch(
      request,
      { contextData: undefined },
    );

    assertEquals(response.status, 202);
    assertEquals(
      inbox.length,
      1,
      "Expected one item in the inbox, json",
    );
    assertEquals(inbox[0], createFixture.id);
  });

  await t.step("GET with application/json", async () => {
    const { federation, dispatches } = createTestContext();

    // Should call dispatcher on GET:
    const response = await federation.fetch(
      new Request("https://example.com/users/json", {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      }),
      { contextData: undefined },
    );

    assertEquals(dispatches, ["json"]);
    assertEquals(response.status, 200);
  });

  await t.step("POST with application/ld+json", async () => {
    const { federation, inbox } = createTestContext();

    const request = await signRequest(
      new Request("https://example.com/users/ld/inbox", {
        method: "POST",
        headers: {
          "Accept": "application/ld+json",
          "Content-Type": "application/activity+json",
        },
        body: JSON.stringify(createFixture),
      }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
    );

    const response = await federation.fetch(
      request,
      { contextData: undefined },
    );

    assertEquals(response.status, 202);
    assertEquals(inbox.length, 1, "Expected one inbox activity, ld+json");
    assertEquals(inbox[0], createFixture.id);
  });

  await t.step("GET with application/ld+json", async () => {
    const { federation, dispatches } = createTestContext();

    const request = new Request("https://example.com/users/ld", {
      method: "GET",
      headers: {
        "Accept": "application/ld+json",
      },
    });

    const response = await federation.fetch(request, {
      contextData: undefined,
    });

    assertEquals(dispatches, ["ld"]);
    assertEquals(response.status, 200);
  });

  await t.step("POST with application/activity+json", async () => {
    const { federation, inbox } = createTestContext();

    const request = await signRequest(
      new Request("https://example.com/users/activity/inbox", {
        method: "POST",
        headers: {
          "Accept": "application/activity+json",
          "Content-Type": "application/activity+json",
        },
        body: JSON.stringify(createFixture),
      }),
      rsaPrivateKey2,
      rsaPublicKey2.id!,
    );

    const response = await federation.fetch(
      request,
      { contextData: undefined },
    );

    assertEquals(response.status, 202);
    assertEquals(inbox.length, 1);
    assertEquals(inbox[0], createFixture.id);
  });

  await t.step("GET with application/activity+json", async () => {
    const { federation, dispatches } = createTestContext();

    const request = new Request("https://example.com/users/activity", {
      method: "GET",
      headers: {
        "Accept": "application/ld+json",
      },
    });

    const response = await federation.fetch(request, {
      contextData: undefined,
    });

    assertEquals(dispatches, ["activity"]);
    assertEquals(response.status, 200);
  });

  await t.step("onNotAcceptable with GET", async () => {
    const { federation } = createTestContext();

    let notAcceptableCalled = false;
    const response = await federation.fetch(
      new Request("https://example.com/users/html", {
        method: "GET",
        headers: { "Accept": "text/html" },
      }),
      {
        contextData: undefined,
        onNotAcceptable: () => {
          notAcceptableCalled = true;
          return new Response("handled by onNotAcceptable", { status: 200 });
        },
      },
    );

    assertEquals(notAcceptableCalled, true);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "handled by onNotAcceptable");
  });

  fetchMock.hardReset();
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
      documentLoaderFactory: () => mockDocumentLoader,
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
      documentLoaderFactory: () => mockDocumentLoader,
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
      () => federation.setInboxListeners("/users/{identifier}/inbox/{extra}"),
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
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity, {
          allowPrivateAddress: true,
        });
        return (url: string) => {
          const urlObj = new URL(url);
          authenticatedRequests.push([url, identity.keyId.href]);
          if (urlObj.host === "example.com") return docLoader(url);
          return mockDocumentLoader(url);
        };
      },
    });
    const inbox: [Context<void>, vocab.Create][] = [];
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, (ctx, create) => {
        inbox.push([ctx, create]);
      });

    let response = await federation.fetch(
      new Request("https://example.com/inbox", {
        method: "POST",
        headers: { "accept": "application/ld+json" },
      }),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 404);

    federation
      .setActorDispatcher(
        "/users/{identifier}",
        (_, identifier) => identifier === "john" ? new vocab.Person({}) : null,
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
      new vocab.Create({
        id: new URL("https://example.com/activities/" + crypto.randomUUID()),
        actor: new URL("https://example.com/person2"),
      });
    response = await federation.fetch(
      new Request(
        "https://example.com/inbox",
        {
          method: "POST",
          body: JSON.stringify(await activity().toJsonLd(options)),
          headers: {
            "accept": "application/ld+json",
            "content-type": "application/ld+json",
          },
        },
      ),
      { contextData: undefined },
    );
    assertEquals(inbox, []);
    assertEquals(response.status, 401);

    response = await federation.fetch(
      new Request("https://example.com/users/no-one/inbox", {
        method: "POST",
        headers: { "accept": "application/ld+json" },
      }),
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
          headers: {
            "accept": "application/ld+json",
            "content-type": "application/ld+json",
          },
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
      headers: {
        "Content-Type": "application/activity+json",
        accept: "application/ld+json",
      },
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
      headers: {
        "Content-Type": "application/activity+json",
        "accept": "application/ld+json",
      },
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
      headers: {
        "Content-Type": "application/activity+json",
        "accept": "application/ld+json",
      },
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
      headers: {
        "Content-Type": "application/activity+json",
        "accept": "application/ld+json",
      },
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
      documentLoaderFactory: () => mockDocumentLoader,
      authenticatedDocumentLoaderFactory(identity) {
        const docLoader = getAuthenticatedDocumentLoader(identity, {
          allowPrivateAddress: true,
        });
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
        (_, identifier) => identifier === "john" ? new vocab.Person({}) : null,
      )
      .setKeyPairsDispatcher(() => [{
        privateKey: rsaPrivateKey2,
        publicKey: rsaPublicKey2.publicKey!,
      }]);
    const error = new Error("test");
    const errors: unknown[] = [];
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {
        throw error;
      })
      .onError((_, e) => {
        errors.push(e);
      });

    const activity = new vocab.Create({
      actor: new URL("https://example.com/person"),
    });
    let request = new Request("https://example.com/users/john/inbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        "Accept": "application/activity+json",
      },
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
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => sourceContextLoader,
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
      documentLoaderFactory: () => mockDocumentLoader,
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
      documentLoaderFactory: () => mockDocumentLoader,
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
      documentLoaderFactory: () => mockDocumentLoader,
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
    let activity = await verifyObject(vocab.Activity, json, options);
    if (activity == null) {
      activity = await vocab.Activity.fromJsonLd(json, options);
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
    allowPrivateAddress: true,
  });
  const context = federation.createContext(new URL("https://example.com/"));

  await t.step("success", async () => {
    const activity = new vocab.Create({
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

const QUEUE_STARTUP_WARNING =
  "Failed to start queue workers automatically: {error}";

interface UnhandledRejectionCapture {
  reasons: unknown[];
  settle(): Promise<void>;
  stop(): void;
}

/**
 * Captures unhandled promise rejections for the duration of a test step.
 *
 * Deno dispatches `unhandledrejection` on `globalThis`, while Node.js and Bun
 * dispatch `unhandledRejection` on `process`.  Bun's test runner currently
 * fires neither, so there the native runner's own unhandled-rejection failure
 * remains the signal; the assertion is harmless otherwise.
 */
function captureUnhandledRejections(): UnhandledRejectionCapture {
  const reasons: unknown[] = [];
  const isDeno = "Deno" in globalThis;
  interface RejectionEvent {
    reason: unknown;
    preventDefault(): void;
  }
  const onRejectionEvent = (event: RejectionEvent): void => {
    // Keep Deno from treating a deliberate pre-fix failure as a fatal error
    // that cancels the remaining tests in this file.
    event.preventDefault();
    reasons.push(event.reason);
  };
  const onProcessRejection = (reason: unknown): void => {
    reasons.push(reason);
  };
  const globalTarget = globalThis as unknown as {
    addEventListener?(
      type: string,
      listener: (event: RejectionEvent) => void,
    ): void;
    removeEventListener?(
      type: string,
      listener: (event: RejectionEvent) => void,
    ): void;
  };
  const proc = (globalThis as unknown as {
    process?: {
      on?(type: string, listener: (reason: unknown) => void): void;
      off?(type: string, listener: (reason: unknown) => void): void;
    };
  }).process;
  if (isDeno) {
    globalTarget.addEventListener?.("unhandledrejection", onRejectionEvent);
  } else {
    proc?.on?.("unhandledRejection", onProcessRejection);
  }
  async function settle(): Promise<void> {
    // Deno dispatches `unhandledrejection` only after two timer turns.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    reasons,
    settle,
    stop() {
      if (isDeno) {
        globalTarget.removeEventListener?.(
          "unhandledrejection",
          onRejectionEvent,
        );
      } else {
        proc?.off?.("unhandledRejection", onProcessRejection);
      }
    },
  };
}

async function configureQueueStartupWarningCapture(
  records: LogRecord[],
): Promise<void> {
  await configure({
    sinks: {
      buffer(record: LogRecord): void {
        records.push(record);
      },
    },
    loggers: [
      { category: "fedify", sinks: ["buffer"], lowestLevel: "warning" },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
}

function queueStartupWarnings(
  records: LogRecord[],
  error: unknown,
): LogRecord[] {
  return records.filter((record) =>
    record.level === "warning" &&
    record.category.length === 3 &&
    record.category[0] === "fedify" &&
    record.category[1] === "federation" &&
    record.category[2] === "queue" &&
    record.rawMessage === QUEUE_STARTUP_WARNING &&
    record.properties.error === error
  );
}

test("Federation.fetch() reports automatic queue startup failures", async (t) => {
  const listenError = new TypeError("simulated listen() failure");
  const queue: MessageQueue = {
    enqueue() {
      return Promise.resolve();
    },
    listen() {
      throw listenError;
    },
  };
  const capture = captureUnhandledRejections();
  const records: LogRecord[] = [];
  await configureQueueStartupWarningCapture(records);
  try {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      queue,
      skipSignatureVerification: true,
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => mockDocumentLoader,
    });
    federation.setActorDispatcher(
      "/actors/{identifier}",
      () => new Person({ id: new URL("https://example.com/actor") }),
    );
    federation.setInboxListeners("/actors/{identifier}/inbox", "/inbox")
      .on(Create, () => {});
    const post = (id: string) =>
      federation.fetch(
        new Request("https://example.com/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/activity+json" },
          body: JSON.stringify({
            "@context": "https://www.w3.org/ns/activitystreams",
            id,
            type: "Create",
            actor: "https://example.com/actor",
          }),
        }),
        { contextData: undefined },
      );

    await t.step("synchronous failure", async () => {
      const response = await post("https://example.com/activities/queued-1");
      assertEquals(response.status, 202);
      await capture.settle();
      assertEquals(queueStartupWarnings(records, listenError).length, 1);
      assertEquals(capture.reasons, []);

      const second = await post("https://example.com/activities/queued-2");
      assertEquals(second.status, 202);
      await capture.settle();
      assertEquals(
        queueStartupWarnings(records, listenError).length,
        1,
        "the warning must be logged only once per federation instance",
      );
      assertEquals(capture.reasons, []);
    });

    await t.step("asynchronous failure", async () => {
      const asyncError = new TypeError("simulated async listen() failure");
      let rejectListen: ((error: unknown) => void) | undefined;
      const asyncQueue: MessageQueue = {
        enqueue() {
          return Promise.resolve();
        },
        listen() {
          return new Promise<void>((_resolve, reject) => {
            rejectListen = reject;
          });
        },
      };
      const asyncFederation = createFederation<void>({
        kv: new MemoryKvStore(),
        queue: asyncQueue,
        skipSignatureVerification: true,
        documentLoaderFactory: () => mockDocumentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      asyncFederation.setActorDispatcher(
        "/actors/{identifier}",
        () => new Person({ id: new URL("https://example.com/actor") }),
      );
      asyncFederation.setInboxListeners(
        "/actors/{identifier}/inbox",
        "/inbox",
      ).on(Create, () => {});
      const response = await asyncFederation.fetch(
        new Request("https://example.com/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/activity+json" },
          body: JSON.stringify({
            "@context": "https://www.w3.org/ns/activitystreams",
            id: "https://example.com/activities/queued-async",
            type: "Create",
            actor: "https://example.com/actor",
          }),
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 202);
      await capture.settle();
      assertEquals(queueStartupWarnings(records, asyncError).length, 0);
      assert(rejectListen != null);
      rejectListen(asyncError);
      await capture.settle();
      assertEquals(
        queueStartupWarnings(records, asyncError).length,
        1,
        "a listener that rejects after startup must still be reported",
      );
      assertEquals(capture.reasons, []);
    });
  } finally {
    await capture.settle();
    capture.stop();
    await reset();
  }
});

test("Federation.startQueue() rejects when a queue cannot listen", async () => {
  const listenError = new TypeError("simulated listen() failure");
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    queue: {
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        throw listenError;
      },
    },
    manuallyStartQueue: true,
  });
  const error = await assertRejects(() => federation.startQueue(undefined));
  assertStrictEquals(error, listenError);
});

test("Federation.startQueue() keeps other queue workers running", async () => {
  const outboxError = new TypeError("simulated outbox listen() failure");
  const lateInboxError = new TypeError("simulated late inbox failure");
  let rejectInbox: ((error: unknown) => void) | undefined;
  let fanoutStarted = false;
  const inbox: MessageQueue = {
    enqueue() {
      return Promise.resolve();
    },
    listen() {
      return new Promise<void>((_resolve, reject) => {
        rejectInbox = reject;
      });
    },
  };
  const outbox: MessageQueue = {
    enqueue() {
      return Promise.resolve();
    },
    listen() {
      throw outboxError;
    },
  };
  const fanout: MessageQueue = {
    enqueue() {
      return Promise.resolve();
    },
    listen() {
      fanoutStarted = true;
      return new Promise<void>(() => {});
    },
  };
  const capture = captureUnhandledRejections();
  try {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      queue: { inbox, outbox, fanout },
      manuallyStartQueue: true,
    });
    const error = await assertRejects(() => federation.startQueue(undefined));
    assertStrictEquals(error, outboxError);
    assert(
      fanoutStarted,
      "a synchronous throw from one queue must not prevent later queues from starting",
    );
    assert(rejectInbox != null);
    rejectInbox(lateInboxError);
    await capture.settle();
    assertEquals(
      capture.reasons,
      [],
      "an earlier listener rejection must remain handled after startup fails",
    );
  } finally {
    await capture.settle();
    capture.stop();
  }
});

test("ContextImpl.sendActivity() reports automatic queue startup failures", async (t) => {
  const sender = [{
    privateKey: ed25519PrivateKey,
    keyId: ed25519Multikey.id!,
  }];
  const recipient = {
    id: new URL("https://example.com/recipient"),
    inboxId: new URL("https://example.com/inbox"),
  };
  const createActivity = () =>
    new Create({
      id: new URL("https://example.com/activities/queue-startup-send"),
      actor: new URL("https://example.com/actor"),
    });

  await t.step("outbox", async () => {
    const listenError = new TypeError("simulated outbox listen() failure");
    const messages: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message) {
        messages.push(message as Message);
        return Promise.resolve();
      },
      listen() {
        throw listenError;
      },
    };
    const capture = captureUnhandledRejections();
    const records: LogRecord[] = [];
    await configureQueueStartupWarningCapture(records);
    try {
      const federation = new FederationImpl<void>({
        kv: new MemoryKvStore(),
        queue: { outbox: queue },
        documentLoaderFactory: () => mockDocumentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      const ctx = new ContextImpl({
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      });
      await ctx.sendActivity(sender, recipient, createActivity());
      assertEquals(messages.map((message) => message.type), ["outbox"]);
      await capture.settle();
      assertEquals(queueStartupWarnings(records, listenError).length, 1);
      assertEquals(capture.reasons, []);
    } finally {
      await capture.settle();
      capture.stop();
      await reset();
    }
  });

  await t.step("fanout", async () => {
    const listenError = new TypeError("simulated fanout listen() failure");
    const messages: Message[] = [];
    const outbox: MessageQueue = {
      enqueue() {
        return Promise.resolve();
      },
      listen() {
        return Promise.resolve();
      },
    };
    const fanout: MessageQueue = {
      enqueue(message) {
        messages.push(message as Message);
        return Promise.resolve();
      },
      listen() {
        throw listenError;
      },
    };
    const capture = captureUnhandledRejections();
    const records: LogRecord[] = [];
    await configureQueueStartupWarningCapture(records);
    try {
      const federation = new FederationImpl<void>({
        kv: new MemoryKvStore(),
        queue: { outbox, fanout },
        documentLoaderFactory: () => mockDocumentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
      });
      const ctx = new ContextImpl({
        data: undefined,
        federation,
        url: new URL("https://example.com/"),
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      });
      await ctx.sendActivity(sender, recipient, createActivity(), {
        fanout: "force",
      });
      assertEquals(messages.map((message) => message.type), ["fanout"]);
      await capture.settle();
      assertEquals(queueStartupWarnings(records, listenError).length, 1);
      assertEquals(capture.reasons, []);
    } finally {
      await capture.settle();
      capture.stop();
      await reset();
    }
  });
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
      // This step delivers to a mocked, unresolvable .example inbox.
      allowPrivateAddress: true,
      kv,
      queue,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {
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
      // This step delivers to a mocked, unresolvable .example inbox.
      allowPrivateAddress: true,
      kv,
      queue,
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(vocab.Create, () => {
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
        contextLoaderFactory: () => restrictiveContextLoader,
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
        contextLoaderFactory: () => restrictiveContextLoader,
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
        contextLoaderFactory: () => processingContextLoader,
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
        contextLoaderFactory: () => restrictiveContextLoader,
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
        contextLoaderFactory: () => restrictiveContextLoader,
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        contextLoaderFactory: () => async (resource: string) => {
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
        documentLoaderFactory: () => mockDocumentLoader,
        contextLoaderFactory: () => mockDocumentLoader,
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

test({
  name: "FederationImpl.processQueuedTask() retries DNS failures",
  // The validator skips DNS when Deno has no network permission.
  ignore: "Deno" in globalThis &&
    (await Deno.permissions.query({ name: "net" })).state !== "granted",
  async fn(t) {
    for (const redirected of [false, true]) {
      await t.step(`redirected: ${redirected}`, async () => {
        const destination = "https://delivery.invalid/inbox";
        const publicInbox = "https://8.8.8.8/inbox";
        const queuedMessages: Message[] = [];
        const delays: (Temporal.Duration | undefined)[] = [];
        const errors: Error[] = [];
        const activities: (vocab.Activity | null)[] = [];
        const attempts: number[] = [];
        const delay = Temporal.Duration.from({ seconds: 5 });
        const federation = new FederationImpl<void>({
          kv: new MemoryKvStore(),
          queue: {
            enqueue(message, options) {
              queuedMessages.push(message);
              delays.push(options?.delay);
              return Promise.resolve();
            },
            listen() {
              return Promise.resolve();
            },
          },
          documentLoaderFactory: () => mockDocumentLoader,
          contextLoaderFactory: () => mockDocumentLoader,
          onOutboxError(error, activity) {
            errors.push(error);
            activities.push(activity);
          },
          outboxRetryPolicy(options) {
            attempts.push(options.attempts);
            return delay;
          },
        });
        const message: OutboxMessage = {
          type: "outbox",
          id: crypto.randomUUID(),
          baseUrl: "https://example.com",
          keys: [],
          activity: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Create",
            id: "https://example.com/activities/dns-failure",
            actor: "https://example.com/users/alice",
            object: { type: "Note", content: "test" },
          },
          activityType: "https://www.w3.org/ns/activitystreams#Create",
          inbox: redirected ? publicInbox : destination,
          sharedInbox: false,
          started: new Date().toISOString(),
          attempt: 0,
          headers: {},
          traceContext: {},
        };
        const originalLookup = dns.lookup;
        const resolverError = new Error("Resolver unavailable");
        const lookups: string[] = [];
        dns.lookup = ((hostname: string) => {
          lookups.push(hostname);
          return Promise.reject(resolverError);
        }) as typeof dns.lookup;
        try {
          fetchMock.mockGlobal().catch(202);
          if (redirected) {
            fetchMock.route(publicInbox, {
              status: 307,
              headers: { Location: destination },
            });
          }
          await federation.processQueuedTask(undefined, message);
          assertEquals(errors.length, 1);
          const error = errors[0];
          assertInstanceOf(error, FetchError);
          assertEquals(error.url.href, destination);
          assertInstanceOf(error.cause, UrlError);
          assertEquals(error.cause.reason, "dns");
          assertStrictEquals(error.cause.cause, resolverError);
          assertEquals(activities.length, 1);
          assertInstanceOf(activities[0], Create);
          assertEquals(
            activities[0].id?.href,
            "https://example.com/activities/dns-failure",
          );
          assertEquals(attempts, [0]);
          assertEquals(queuedMessages, [{ ...message, attempt: 1 }]);
          assertEquals(delays, [delay]);
          // TODO: On 2.3+, also assert one failed-delivery metric and a
          // circuit-breaker failure for both direct and redirected inboxes.
          // https://github.com/fedify-dev/fedify/issues/1055
          assertEquals(lookups, ["delivery.invalid"]);
          assertEquals(fetchMock.callHistory.calls(destination).length, 0);
          assertEquals(
            fetchMock.callHistory.calls().length,
            redirected ? 1 : 0,
          );
        } finally {
          dns.lookup = originalLookup;
          fetchMock.hardReset();
        }
      });
    }
  },
});

test("FederationImpl.processQueuedTask() permanent failure", async (t) => {
  fetchMock.spyGlobal();

  fetchMock.post("https://gone.example/inbox", {
    status: 410,
    body: "Gone",
  });
  fetchMock.post("https://notfound.example/inbox", {
    status: 404,
    body: "Not Found",
  });
  fetchMock.post("https://error.example/inbox", {
    status: 500,
    body: "Internal Server Error",
  });
  fetchMock.post("https://legal.example/inbox", {
    status: 451,
    body: "Unavailable For Legal Reasons",
  });

  interface PermanentFailureSetup {
    federation: FederationImpl<void>;
    queuedMessages: Message[];
  }

  function setup(
    options: {
      permanentFailureStatusCodes?: readonly number[];
      nativeRetrial?: boolean;
    } = {},
  ): PermanentFailureSetup {
    const kv = new MemoryKvStore();
    const queuedMessages: Message[] = [];
    const queue: MessageQueue = {
      ...(options.nativeRetrial ? { nativeRetrial: true } : {}),
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
      // These delivery-error tests use mocked, unresolvable .example inboxes.
      allowPrivateAddress: true,
      ...(options.permanentFailureStatusCodes
        ? { permanentFailureStatusCodes: options.permanentFailureStatusCodes }
        : {}),
    });
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
    return { federation, queuedMessages };
  }

  function createOutboxMessage(
    inbox: string,
    activityId: string,
    actorIds?: string[],
  ): OutboxMessage {
    return {
      type: "outbox",
      id: crypto.randomUUID(),
      baseUrl: "https://example.com",
      keys: [],
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: activityId,
        actor: "https://example.com/users/alice",
        object: { type: "Note", content: "test" },
      },
      activityType: "https://www.w3.org/ns/activitystreams#Create",
      inbox,
      sharedInbox: false,
      ...(actorIds != null ? { actorIds } : {}),
      started: new Date().toISOString(),
      attempt: 0,
      headers: {},
      traceContext: {},
    };
  }

  await t.step("410 Gone triggers permanent failure handler", async () => {
    const { federation, queuedMessages } = setup();
    let handlerCalled = false;
    let handlerValues: Record<string, unknown> = {};
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      handlerCalled = true;
      handlerValues = { ...values };
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://gone.example/inbox",
        "https://example.com/activity/1",
        [
          "https://gone.example/users/bob",
          "https://gone.example/users/charlie",
        ],
      ),
    );
    assert(handlerCalled, "Permanent failure handler should be called");
    assertEquals(
      handlerValues.inbox,
      new URL("https://gone.example/inbox"),
    );
    assertEquals(handlerValues.statusCode, 410);
    assertInstanceOf(handlerValues.activity, vocab.Create);
    assertEquals(handlerValues.actorIds, [
      new URL("https://gone.example/users/bob"),
      new URL("https://gone.example/users/charlie"),
    ]);
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);
  });

  await t.step("404 Not Found triggers permanent failure handler", async () => {
    const { federation, queuedMessages } = setup();
    let handlerCalled = false;
    let handlerStatusCode = 0;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      handlerCalled = true;
      handlerStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://notfound.example/inbox",
        "https://example.com/activity/2",
        ["https://notfound.example/users/bob"],
      ),
    );
    assert(handlerCalled, "Permanent failure handler should be called");
    assertEquals(handlerStatusCode, 404);
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);
  });

  await t.step(
    "500 error does NOT trigger permanent failure handler",
    async () => {
      const { federation, queuedMessages } = setup();
      let handlerCalled = false;
      federation.setOutboxPermanentFailureHandler(() => {
        handlerCalled = true;
      });

      await federation.processQueuedTask(
        undefined,
        createOutboxMessage(
          "https://error.example/inbox",
          "https://example.com/activity/3",
          ["https://error.example/users/bob"],
        ),
      );
      assertFalse(
        handlerCalled,
        "Permanent failure handler should NOT be called",
      );
      // Should be re-enqueued for retry (normal retry behavior)
      assertEquals(queuedMessages.length, 1);
      assertEquals((queuedMessages[0] as OutboxMessage).attempt, 1);
    },
  );

  await t.step("custom permanentFailureStatusCodes", async () => {
    const { federation, queuedMessages } = setup({
      permanentFailureStatusCodes: [404, 410, 451],
    });
    let handlerCalled = false;
    let handlerStatusCode = 0;
    federation.setOutboxPermanentFailureHandler((_ctx, values) => {
      handlerCalled = true;
      handlerStatusCode = values.statusCode;
    });

    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://legal.example/inbox",
        "https://example.com/activity/4",
        ["https://legal.example/users/bob"],
      ),
    );
    assert(handlerCalled, "Permanent failure handler should be called for 451");
    assertEquals(handlerStatusCode, 451);
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);
  });

  await t.step("handler exception is caught and logged", async () => {
    const { federation, queuedMessages } = setup();
    federation.setOutboxPermanentFailureHandler(() => {
      throw new Error("Handler error that should be ignored");
    });

    // Should not throw even though the handler throws
    await federation.processQueuedTask(
      undefined,
      createOutboxMessage(
        "https://gone.example/inbox",
        "https://example.com/activity/5",
        ["https://gone.example/users/bob"],
      ),
    );
    // Should NOT be re-enqueued for retry
    assertEquals(queuedMessages, []);
  });

  await t.step(
    "permanent failure skips retry without handler registered",
    async () => {
      const { federation, queuedMessages } = setup();
      // No handler registered

      await federation.processQueuedTask(
        undefined,
        createOutboxMessage(
          "https://gone.example/inbox",
          "https://example.com/activity/6",
          [],
        ),
      );
      // Should NOT be re-enqueued for retry even without a handler
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "nativeRetrial: permanent failure does not re-throw",
    async () => {
      const { federation, queuedMessages } = setup({
        nativeRetrial: true,
      });
      let handlerCalled = false;
      federation.setOutboxPermanentFailureHandler(() => {
        handlerCalled = true;
      });

      // Should NOT throw (unlike non-permanent failures with nativeRetrial)
      await federation.processQueuedTask(
        undefined,
        createOutboxMessage(
          "https://gone.example/inbox",
          "https://example.com/activity/7",
          ["https://gone.example/users/bob"],
        ),
      );
      assert(handlerCalled, "Permanent failure handler should be called");
      assertEquals(queuedMessages, []);
    },
  );

  await t.step(
    "actorIds missing from message defaults to empty array",
    async () => {
      const { federation, queuedMessages } = setup();
      let handlerActorIds: readonly URL[] = [];
      federation.setOutboxPermanentFailureHandler((_ctx, values) => {
        handlerActorIds = values.actorIds;
      });

      await federation.processQueuedTask(
        undefined,
        // No actorIds field (simulating old message format)
        createOutboxMessage(
          "https://gone.example/inbox",
          "https://example.com/activity/8",
        ),
      );
      assertEquals(handlerActorIds, []);
      assertEquals(queuedMessages, []);
    },
  );

  fetchMock.hardReset();
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
    assertInstanceOf(result, vocab.Person);
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
          new Request(url, { headers: { "accept": "application/ld+json" } }),
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
        async set(
          _keyId: URL,
          _key: vocab.CryptographicKey | vocab.Multikey | null,
        ) {
        },
      } satisfies KeyCache,
    };
    let json = await cl.request!.json();
    if (await verifyJsonLd(json, options)) verified.push("ld");
    json = detachSignature(json);
    let activity = await verifyObject(vocab.Activity, json, options);
    if (activity == null) {
      activity = await vocab.Activity.fromJsonLd(json, options);
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
    allowPrivateAddress: true,
  });

  federation
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "1") return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new vocab.Person({
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
    const activity = new vocab.Create({
      actor: new URL("https://example.com/person"),
    });
    const ctx = new ContextImpl({
      data: undefined,
      federation,
      url: new URL("https://example.com/"),
      documentLoader: documentLoader,
      contextLoader: documentLoader,
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
    allowPrivateAddress: true,
    queue,
  });
  federation2
    .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
      if (identifier !== "john" && identifier !== "rsa-only") return null;
      const keys = await ctx.getActorKeyPairs(identifier);
      return new vocab.Person({
        id: ctx.getActorUri(identifier),
        preferredUsername: identifier,
        publicKey: keys[0].cryptographicKey,
        assertionMethods: keys.map((k) => k.multikey),
      });
    })
    .setKeyPairsDispatcher((_ctx, identifier) => {
      if (identifier === "rsa-only") {
        return [
          { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
        ];
      }
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
    documentLoader: documentLoader,
    contextLoader: documentLoader,
  });

  await t.step('fanout: "force"', async () => {
    const activity = new vocab.Create({
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
    assertEquals(fanoutMsg.orderingKey, undefined);
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
    const signedActivity = await vocab.Create.fromJsonLd(fanoutMsg.activity, {
      contextLoader: documentLoader,
      documentLoader: documentLoader,
    });
    assertEquals(signedActivity.id?.href, "https://example.com/activity/1");
    let proofCount = 0;
    for await (
      const proof of signedActivity.getProofs({
        contextLoader: documentLoader,
      })
    ) {
      assertEquals(
        proof.verificationMethodId?.href,
        "https://example.com/john#multikey-2",
      );
      proofCount++;
    }
    assertEquals(proofCount, 1);

    // Replaying a fanout message created before the context change must keep
    // the proof-covered context when it is queued for delivery.
    const oldContext = [
      "https://w3id.org/identity/v1",
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ];
    const oldActivity = new vocab.Create({
      id: new URL("https://example.com/activity/1"),
      actor: new URL("https://example.com/john"),
    });
    const oldSigned = await signObject(
      oldActivity,
      ed25519PrivateKey,
      ed25519Multikey.id!,
      { contextLoader: documentLoader, context: oldContext },
    );
    const oldJson = await oldSigned.toJsonLd({
      format: "compact",
      contextLoader: documentLoader,
      context: oldContext,
    }) as Record<string, unknown>;
    queue.clear();
    await federation2.processQueuedTask(undefined, {
      ...fanoutMsg,
      id: crypto.randomUUID(),
      activity: oldJson,
    });
    const replayed = queue.messages.at(-1);
    assert(replayed != null && replayed.type === "outbox");
    assertEquals(detachSignature(replayed.activity), oldJson);

    const proofless = { ...oldJson };
    delete proofless.proof;
    queue.clear();
    await federation2.processQueuedTask(undefined, {
      ...fanoutMsg,
      id: crypto.randomUUID(),
      activity: proofless,
    });
    const signedReplay = queue.messages.at(-1);
    assert(signedReplay != null && signedReplay.type === "outbox");
    assert(
      typeof signedReplay.activity === "object" &&
        signedReplay.activity != null &&
        "proof" in signedReplay.activity,
    );

    // The public direct-send path must also keep a pre-upgrade proof covered.
    const actorKeys = await ctx2.getActorKeyPairs("john");
    const edKey = actorKeys.find((key) =>
      key.privateKey.algorithm.name === "Ed25519"
    );
    assert(edKey != null && edKey.multikey.id != null);
    const restoredActivity = new vocab.Create({
      id: new URL("https://example.com/activity/old"),
      actor: ctx2.getActorUri("john"),
    });
    const restoredSigned = await signObject(
      restoredActivity,
      edKey.privateKey,
      edKey.multikey.id!,
      { contextLoader: documentLoader, context: oldContext },
    );
    const restoredJson = await restoredSigned.toJsonLd({
      format: "compact",
      contextLoader: documentLoader,
      context: oldContext,
    }) as Record<string, unknown>;
    const restored = await vocab.Create.fromJsonLd(restoredJson, {
      contextLoader: documentLoader,
      documentLoader,
    });
    queue.clear();
    await ctx2.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      restored,
    );
    const resent = queue.messages.at(-1);
    assert(resent != null && resent.type === "outbox");
    assertEquals(detachSignature(resent.activity), restoredJson);

    queue.clear();
    await ctx2.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      restored,
      { fanout: "force" },
    );
    const queuedFanout = queue.messages.at(-1);
    assert(queuedFanout != null && queuedFanout.type === "fanout");
    assertEquals(queuedFanout.activity, restoredJson);

    const oldSignature = {
      "@context": "https://w3id.org/identity/v1",
      type: "RsaSignature2017",
      creator: "https://example.com/person2#key4",
      created: "2026-01-01T00:00:00Z",
      signatureValue: "abc",
    } as const;
    const restoredWithSignature = await vocab.Create.fromJsonLd(
      attachSignature(restoredJson, oldSignature),
      { contextLoader: documentLoader, documentLoader },
    );
    queue.clear();
    await ctx2.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      restoredWithSignature,
    );
    const resigned = queue.messages.at(-1);
    assert(resigned != null && resigned.type === "outbox");
    assertEquals(detachSignature(resigned.activity), restoredJson);

    const rsaOnlyActivity = new vocab.Create({
      id: new URL("https://example.com/activity/rsa-only"),
      actor: new URL("https://example.com/rsa-only"),
    });
    const rsaOnlySigned = await signObject(
      rsaOnlyActivity,
      ed25519PrivateKey,
      ed25519Multikey.id!,
      { contextLoader: documentLoader, context: oldContext },
    );
    const rsaOnlyJson = await rsaOnlySigned.toJsonLd({
      format: "compact",
      contextLoader: documentLoader,
      context: oldContext,
    }) as Record<string, unknown>;
    const rsaOnlyRestored = await vocab.Create.fromJsonLd(rsaOnlyJson, {
      contextLoader: documentLoader,
      documentLoader,
    });
    queue.clear();
    await ctx2.sendActivity(
      { identifier: "rsa-only" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      rsaOnlyRestored,
      { fanout: "force" },
    );
    const rsaOnlyMessage = queue.messages.at(-1);
    assert(rsaOnlyMessage != null && rsaOnlyMessage.type === "fanout");
    assertEquals(rsaOnlyMessage.activity, rsaOnlyJson);

    queue.clear();
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      restored,
      { fanout: "force" },
    );
    const namedFanout = queue.messages.at(-1);
    assert(namedFanout != null && namedFanout.type === "fanout");
    const namedJson = detachSignature(namedFanout.activity) as Record<
      string,
      unknown
    >;
    const namedProofs = Array.isArray(namedJson.proof)
      ? namedJson.proof
      : [namedJson.proof];
    assertEquals(namedProofs.length, 1);
    assert(
      (namedJson["@context"] as string[]).includes(
        "https://w3id.org/security/v1",
      ),
    );

    const noIdActivity = new vocab.Create({
      actor: ctx2.getActorUri("john"),
    });
    const noIdSigned = await signObject(
      noIdActivity,
      edKey.privateKey,
      edKey.multikey.id!,
      { contextLoader: documentLoader, context: oldContext },
    );
    const noIdJson = await noIdSigned.toJsonLd({
      format: "compact",
      contextLoader: documentLoader,
      context: oldContext,
    }) as Record<string, unknown>;
    const noIdRestored = await vocab.Create.fromJsonLd(noIdJson, {
      contextLoader: documentLoader,
      documentLoader,
    });
    queue.clear();
    await ctx2.sendActivity(
      [{ privateKey: rsaPrivateKey2, keyId: rsaPublicKey2.id! }],
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      noIdRestored,
    );
    const noIdQueued = queue.messages.at(-1);
    assert(noIdQueued != null && noIdQueued.type === "outbox");
    const noIdQueuedJson = detachSignature(noIdQueued.activity) as Record<
      string,
      unknown
    >;
    assert(typeof noIdQueuedJson.id === "string");

    const currentActivity = new vocab.Create({
      id: new URL("https://example.com/activity/current"),
      actor: ctx2.getActorUri("john"),
    });
    const currentSigned = await signObject(
      currentActivity,
      edKey.privateKey,
      edKey.multikey.id!,
      { contextLoader: documentLoader },
    );
    const currentJson = await currentSigned.toJsonLd({
      format: "compact",
      contextLoader: documentLoader,
    }) as Record<string, unknown>;
    const currentRestored = await vocab.Create.fromJsonLd(currentJson, {
      contextLoader: documentLoader,
      documentLoader,
    });
    queue.clear();
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      currentRestored,
      { fanout: "force" },
    );
    const currentFanout = queue.messages.at(-1);
    assert(currentFanout != null && currentFanout.type === "fanout");
    const currentQueued = detachSignature(currentFanout.activity) as Record<
      string,
      unknown
    >;
    const currentProofs = Array.isArray(currentQueued.proof)
      ? currentQueued.proof
      : [currentQueued.proof];
    assertEquals(currentProofs.length, 2);
  });

  queue.clear();

  await t.step("activity transformers preserve proofs", async () => {
    const originalProof = new vocab.DataIntegrityProof({
      cryptosuite: "eddsa-jcs-2022",
      verificationMethod: new URL("https://example.com/rsa-only#multikey-2"),
      proofPurpose: "assertionMethod",
      proofValue: new Uint8Array([1, 2, 3, 4]),
      created: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    });
    const addedProof = new vocab.DataIntegrityProof({
      cryptosuite: "eddsa-jcs-2022",
      verificationMethod: new URL("https://example.com/rsa-only#multikey-2"),
      proofPurpose: "assertionMethod",
      proofValue: new Uint8Array([5, 6, 7, 8]),
      created: Temporal.Instant.from("2026-01-02T00:00:00Z"),
    });
    const replacementProof = new vocab.DataIntegrityProof({
      cryptosuite: "eddsa-jcs-2022",
      verificationMethod: new URL("https://example.com/rsa-only#multikey-2"),
      proofPurpose: "assertionMethod",
      proofValue: new Uint8Array([9, 10, 11, 12]),
      created: Temporal.Instant.from("2026-01-03T00:00:00Z"),
    });
    const restoredProof = new vocab.DataIntegrityProof({
      cryptosuite: "eddsa-jcs-2022",
      verificationMethod: new URL("https://example.com/rsa-only#multikey-2"),
      proofPurpose: "assertionMethod",
      proofValue: new Uint8Array([13, 14, 15, 16]),
      created: Temporal.Instant.from("2026-01-04T00:00:00Z"),
    });
    const restoredProofHolder: { old?: vocab.DataIntegrityProof } = {};
    const federation3 = new FederationImpl<void>({
      kv,
      allowPrivateAddress: true,
      queue,
      activityTransformers: [
        (activity) => {
          if (
            activity.id?.href ===
              "https://example.com/activity/transformed-proof"
          ) {
            return activity.clone({ proofs: [originalProof, addedProof] });
          }
          if (
            activity.id?.href ===
              "https://example.com/activity/replaced-proof"
          ) {
            return new vocab.Create({
              id: activity.id,
              actor: new URL("https://example.com/rsa-only"),
              object: new URL("https://example.com/note/replaced"),
              proofs: [replacementProof],
            });
          }
          if (
            activity.id?.href === "https://example.com/activity/restored-proof"
          ) {
            return activity.clone({
              proofs: [restoredProofHolder.old!, restoredProof],
            });
          }
          return activity;
        },
      ],
    });
    federation3
      .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
        if (identifier !== "rsa-only") return null;
        const keys = await ctx.getActorKeyPairs(identifier);
        return new vocab.Person({
          id: ctx.getActorUri(identifier),
          preferredUsername: identifier,
          publicKey: keys[0].cryptographicKey,
          assertionMethods: keys.map((k) => k.multikey),
        });
      })
      .setKeyPairsDispatcher((_ctx, identifier) =>
        identifier === "rsa-only"
          ? [
            {
              privateKey: rsaPrivateKey2,
              publicKey: rsaPublicKey2.publicKey!,
            },
          ]
          : []
      );
    const ctx3 = new ContextImpl({
      data: undefined,
      federation: federation3,
      url: new URL("https://example.com/"),
      documentLoader: documentLoader,
      contextLoader: documentLoader,
    });
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/transformed-proof"),
      actor: ctx3.getActorUri("rsa-only"),
      proofs: [originalProof],
    });
    await ctx3.sendActivity(
      { identifier: "rsa-only" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force" },
    );
    const fanout = queue.messages.at(-1);
    assert(fanout != null && fanout.type === "fanout");
    const fanoutJson = detachSignature(fanout.activity) as Record<
      string,
      unknown
    >;
    const fanoutProofs = Array.isArray(fanoutJson.proof)
      ? fanoutJson.proof
      : [fanoutJson.proof];
    assertEquals(fanoutProofs.length, 2);

    // A transformer may also replace the content and supply a new proof.
    const replacedActivity = new vocab.Create({
      id: new URL("https://example.com/activity/replaced-proof"),
      actor: ctx3.getActorUri("rsa-only"),
      proofs: [originalProof],
    });
    queue.clear();
    await ctx3.sendActivity(
      { identifier: "rsa-only" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      replacedActivity,
      { fanout: "force" },
    );
    const replacedFanout = queue.messages.at(-1);
    assert(replacedFanout != null && replacedFanout.type === "fanout");
    const replacedJson = detachSignature(replacedFanout.activity) as Record<
      string,
      unknown
    >;
    assertEquals(
      replacedJson.object,
      "https://example.com/note/replaced",
    );
    const replacedProofs = Array.isArray(replacedJson.proof)
      ? replacedJson.proof
      : [replacedJson.proof];
    assertEquals(replacedProofs.length, 1);
    const [keptProof] = replacedProofs as Record<string, unknown>[];
    assertEquals(keptProof.created, "2026-01-03T00:00:00Z");

    // A restored activity with an old context must still use proof changes
    // made by a transformer instead of the captured old-context snapshot.
    const oldContext = [
      "https://w3id.org/identity/v1",
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/data-integrity/v1",
    ];
    const restoredBase = new vocab.Create({
      id: new URL("https://example.com/activity/restored-proof"),
      actor: ctx3.getActorUri("rsa-only"),
    });
    const restoredSigned = await signObject(
      restoredBase,
      ed25519PrivateKey,
      ed25519Multikey.id!,
      { contextLoader: documentLoader, context: oldContext },
    );
    const restoredJson = await restoredSigned.toJsonLd({
      format: "compact",
      contextLoader: documentLoader,
      context: oldContext,
    }) as Record<string, unknown>;
    const restored = await vocab.Create.fromJsonLd(restoredJson, {
      contextLoader: documentLoader,
      documentLoader,
    });
    for await (
      const proof of restored.getProofs({ contextLoader: documentLoader })
    ) {
      restoredProofHolder.old = proof;
      break;
    }
    queue.clear();
    await ctx3.sendActivity(
      { identifier: "rsa-only" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      restored,
      { fanout: "force" },
    );
    const restoredFanout = queue.messages.at(-1);
    assert(restoredFanout != null && restoredFanout.type === "fanout");
    const restoredFanoutJson = detachSignature(
      restoredFanout.activity,
    ) as Record<
      string,
      unknown
    >;
    const restoredProofs = Array.isArray(restoredFanoutJson.proof)
      ? restoredFanoutJson.proof
      : [restoredFanoutJson.proof];
    assertEquals(restoredProofs.length, 1);
    const [transformedProof] = restoredProofs as Record<string, unknown>[];
    assertEquals(transformedProof.created, "2026-01-04T00:00:00Z");
    assert(
      Array.isArray(restoredFanoutJson["@context"]) &&
        restoredFanoutJson["@context"].includes(
          "https://w3id.org/security/v1",
        ),
    );

    // Equivalent timestamps with a different lexical form must not make the
    // captured proof look newly supplied by a transformer.
    const staleTimestampBase = new vocab.Create({
      id: new URL("https://example.com/activity/stale-timestamp"),
      actor: ctx3.getActorUri("rsa-only"),
    });
    const staleTimestampSigned = await signObject(
      staleTimestampBase,
      ed25519PrivateKey,
      ed25519Multikey.id!,
      { contextLoader: documentLoader, context: oldContext },
    );
    const staleTimestampJson = await staleTimestampSigned.toJsonLd({
      format: "compact",
      contextLoader: documentLoader,
      context: oldContext,
    }) as Record<string, unknown>;
    const staleTimestampProof = (
      Array.isArray(staleTimestampJson.proof)
        ? staleTimestampJson.proof[0]
        : staleTimestampJson.proof
    ) as Record<string, unknown>;
    staleTimestampProof.created = "2026-01-01T00:00:00+00:00";
    const staleTimestamp = await vocab.Create.fromJsonLd(staleTimestampJson, {
      contextLoader: documentLoader,
      documentLoader,
    });
    queue.clear();
    await ctx3.sendActivity(
      { identifier: "rsa-only" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      staleTimestamp,
      { fanout: "force" },
    );
    const staleTimestampFanout = queue.messages.at(-1);
    assert(
      staleTimestampFanout != null && staleTimestampFanout.type === "fanout",
    );
    assertEquals(
      detachSignature(staleTimestampFanout.activity),
      staleTimestampJson,
    );

    // A proofless activity should not be serialized just to look for proofs.
    const proofless = new vocab.Create({
      id: new URL("https://example.com/activity/proofless"),
      actor: ctx3.getActorUri("rsa-only"),
    });
    let unformattedSerializations = 0;
    const originalToJsonLd = proofless.toJsonLd.bind(proofless);
    Object.defineProperty(proofless, "toJsonLd", {
      value: async (options?: { format?: "compact" | "expand" }) => {
        if (options?.format == null) unformattedSerializations++;
        return await originalToJsonLd(options);
      },
    });
    queue.clear();
    await ctx3.sendActivity(
      { identifier: "rsa-only" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      proofless,
      { fanout: "skip" },
    );
    assertEquals(unformattedSerializations, 0);
  });

  queue.clear();

  await t.step('fanout: "skip"', async () => {
    const activity = new vocab.Create({
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
    const activity = new vocab.Create({
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
        allowPrivateAddress: true,
        queue: asyncQueue,
        manuallyStartQueue: true,
      });
      fed
        .setActorDispatcher("/{identifier}", async (ctx, identifier) => {
          if (identifier !== "john") return null;
          const keys = await ctx.getActorKeyPairs(identifier);
          return new vocab.Person({
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
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      });
      const activity = new vocab.Create({
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
      documentLoader: documentLoader,
      contextLoader: documentLoader,
    });

    const activity = new vocab.Create({
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
      documentLoader: documentLoader,
      contextLoader: documentLoader,
    });

    const activity = new vocab.Create({
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

  queue.clear();

  await t.step('orderingKey with fanout: "force"', async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/ordering-1"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "force", orderingKey: "https://example.com/note/1" },
    );
    assertEquals(queue.messages.length, 1);
    const fanoutMessage = queue.messages[0];
    assertEquals(fanoutMessage.type, "fanout");
    if (fanoutMessage.type === "fanout") {
      assertEquals(
        fanoutMessage.orderingKey,
        "https://example.com/note/1",
      );
    }
  });

  queue.clear();

  await t.step('orderingKey with fanout: "skip"', async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/ordering-2"),
      actor: new URL("https://example.com/person"),
    });
    await ctx2.sendActivity(
      { username: "john" },
      {
        id: new URL("https://example.com/recipient"),
        inboxId: new URL("https://example.com/inbox"),
      },
      activity,
      { fanout: "skip", orderingKey: "https://example.com/note/2" },
    );
    assertEquals(queue.messages.length, 1);
    const outboxMessage = queue.messages[0];
    assertEquals(outboxMessage.type, "outbox");
    // outbox message should have orderingKey transformed to include inbox origin
    if (outboxMessage.type === "outbox") {
      assertEquals(
        outboxMessage.orderingKey,
        "https://example.com/note/2\nhttps://example.com",
      );
    }
  });

  queue.clear();

  await t.step("orderingKey not specified", async () => {
    const activity = new vocab.Create({
      id: new URL("https://example.com/activity/ordering-3"),
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
    const fanoutMessage2 = queue.messages[0];
    assertEquals(fanoutMessage2.type, "fanout");
    if (fanoutMessage2.type === "fanout") {
      assertEquals(fanoutMessage2.orderingKey, undefined);
    }
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

    const activities: [string | null, vocab.Activity][] = [];
    federation
      .setInboxListeners("/u/{identifier}/i", "/i")
      .on(vocab.Offer, (ctx, offer) => {
        activities.push([ctx.recipient, offer]);
      });

    const ctx = new ContextImpl({
      url: new URL("https://example.com/"),
      federation,
      data: undefined,
      documentLoader: mockDocumentLoader,
      contextLoader: documentLoader,
    });

    // Unsigned & non-dereferenceable activity
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Offer({
          actor: new URL("https://example.com/person"),
        }),
      ),
    );
    assertEquals(activities, []);

    // Signed activity without recipient (shared inbox)
    const signedOffer = await signObject(
      new vocab.Offer({
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity(null, signedOffer));
    assertEquals(activities, [[null, signedOffer]]);

    // Signed activity with recipient (personal inbox)
    const signedInvite = await signObject(
      new vocab.Invite({
        actor: new URL("https://example.com/person2"),
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
    );
    assert(await ctx.routeActivity("id", signedInvite));
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 404; the WebFinger fallback of
    // lookupObject() must not reach the network:
    assertFalse(
      await withDnsLookup(
        () => Promise.reject(new Error("Resolver unavailable")),
        () =>
          ctx.routeActivity(
            null,
            new vocab.Create({
              id: new URL("https://example.com/not-found"),
              actor: new URL("https://example.com/person"),
            }),
          ),
      ),
    );
    assertEquals(activities, [[null, signedOffer], ["id", signedInvite]]);

    // Unsigned activity dereferenced to 200, but not an Activity
    assertFalse(
      await ctx.routeActivity(
        null,
        new vocab.Create({
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
        new vocab.Announce({
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
        new vocab.Announce({
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
        new vocab.Create({
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
        new vocab.Create({
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
        new vocab.Invite({
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
          new vocab.Invite({
            id: new URL("https://example.com/invite"),
            actor: new URL("https://example.com/person"),
            object: new URL("https://example.com/object"),
          }),
        ],
      ],
    );
  },
});

for (const queued of [false, true]) {
  test(`ContextImpl.routeActivity() routes the fetched document (queued: ${queued})`, async () => {
    const id = new URL("https://example.com/verified-create");
    const genuine = new Create({
      id,
      actor: new URL("https://example.com/person"),
      object: new vocab.Note({ content: "Genuine content" }),
      to: new URL("https://example.com/recipient"),
    });
    const genuineJson = await genuine.toJsonLd({
      contextLoader: mockDocumentLoader,
    });
    const forged = new Create({
      id,
      actor: new URL("https://victim.example/actor"),
      object: new vocab.Note({ content: "Forged content" }),
      to: new URL("https://attacker.example/recipient"),
    });
    const messages: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message) {
        messages.push(message as Message);
        return Promise.resolve();
      },
      async listen() {},
    };
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => async (url, options) =>
        url === id.href
          ? { document: genuineJson, documentUrl: id.href, contextUrl: null }
          : await mockDocumentLoader(url, options),
      contextLoaderFactory: () => mockDocumentLoader,
      queue: { inbox: queued ? queue : undefined, outbox: queue },
      manuallyStartQueue: true,
    });
    const received: unknown[] = [];
    const contextDocuments: unknown[] = [];
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, async (ctx, activity) => {
        received.push(
          await activity.toJsonLd({
            contextLoader: mockDocumentLoader,
          }),
        );
        assertInstanceOf(ctx, InboxContextImpl);
        contextDocuments.push(ctx.activity);
        await ctx.forwardActivity(
          { privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! },
          {
            id: new URL("https://example.com/recipient"),
            inboxId: new URL("https://example.com/inbox"),
          },
        );
      });
    const ctx = federation.createContext(new URL("https://local.example/"));
    async function processInbox() {
      const inboxMessages = messages.filter((message) =>
        message.type === "inbox"
      );
      for (const message of inboxMessages) {
        await federation.processQueuedTask(undefined, message);
      }
    }

    assert(await ctx.routeActivity(null, forged));
    if (queued) {
      assertEquals(received, []);
      assertEquals(messages.length, 1);
      assertEquals(messages[0].activity, genuineJson);
      await processInbox();
    }
    assertEquals(received, [genuineJson]);
    assertEquals(contextDocuments, [genuineJson]);
    const forwarded = messages.filter((message) => message.type === "outbox");
    assertEquals(forwarded.length, 1);
    assertEquals(forwarded[0].activity, genuineJson);

    // The forged input has already caused the genuine document to be
    // processed, so routing the genuine activity later is a safe duplicate.
    assert(await ctx.routeActivity(null, genuine));
    if (queued) await processInbox();
    assertEquals(received, [genuineJson]);
    assertEquals(contextDocuments, [genuineJson]);
    assertEquals(
      messages.filter((message) => message.type === "outbox").length,
      1,
    );
  });
}

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
    contextLoader: documentLoader,
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

for (const queued of [false, true]) {
  test(`ContextImpl.routeActivity() rejects a proof-signed cross-origin ID (queued: ${queued})`, async () => {
    const messages: Message[] = [];
    const queue: MessageQueue = {
      enqueue(message) {
        messages.push(message as Message);
        return Promise.resolve();
      },
      async listen() {},
    };
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => mockDocumentLoader,
      queue: queued ? { inbox: queue, outbox: queue } : undefined,
      manuallyStartQueue: true,
    });
    let listenerCalls = 0;
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, () => {
        listenerCalls++;
      });
    const signed = await signObject(
      new Create({
        id: new URL("https://victim.example/activities/1"),
        actor: ed25519Multikey.controllerId!,
      }),
      ed25519PrivateKey,
      ed25519Multikey.id!,
      {
        contextLoader: mockDocumentLoader,
        documentLoader: mockDocumentLoader,
      },
    );
    const ctx = federation.createContext(new URL("https://local.example/"));

    assertFalse(await ctx.routeActivity(null, signed));
    assertEquals(listenerCalls, 0);
    assertEquals(messages, []);
  });
}

test("ContextImpl.routeActivity() rejects a missing actor before routing", async () => {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  let listenerCalls = 0;
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, () => {
      listenerCalls++;
    });
  const ctx = federation.createContext(new URL("https://local.example/"));

  assertFalse(
    await ctx.routeActivity(
      null,
      new Create({ id: new URL("https://remote.example/activities/1") }),
    ),
  );
  assertEquals(listenerCalls, 0);
});

test("FederationImpl.processQueuedTask() rejects untrusted activity origins before KV access", async () => {
  class TrackingKvStore extends MemoryKvStore {
    reads = 0;
    writes = 0;

    override get<T = unknown>(key: KvKey): Promise<T | undefined> {
      this.reads++;
      return super.get<T>(key);
    }

    override set(
      key: KvKey,
      value: unknown,
      options?: KvStoreSetOptions,
    ): Promise<void> {
      this.writes++;
      return super.set(key, value, options);
    }
  }

  for (
    const activity of [
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://victim.example/activities/1",
        type: "Create",
        actor: "https://attacker.example/actor",
      },
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://victim.example/activities/2",
        type: "Create",
      },
    ]
  ) {
    const kv = new TrackingKvStore();
    const federation = new FederationImpl<void>({ kv });
    let listenerCalls = 0;
    federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
      .on(Create, () => {
        listenerCalls++;
      });
    await federation.processQueuedTask(
      undefined,
      {
        type: "inbox",
        id: crypto.randomUUID(),
        baseUrl: "https://local.example",
        activity,
        started: new Date().toISOString(),
        attempt: 0,
        identifier: null,
        traceContext: {},
      } satisfies InboxMessage,
    );
    assertEquals(listenerCalls, 0);
    assertEquals(kv.reads, 0);
    assertEquals(kv.writes, 0);
  }

  const kv = new TrackingKvStore();
  const federation = new FederationImpl<void>({
    kv,
    skipSignatureVerification: true,
  });
  let listenerCalls = 0;
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox")
    .on(Create, () => {
      listenerCalls++;
    });
  await federation.processQueuedTask(
    undefined,
    {
      type: "inbox",
      id: crypto.randomUUID(),
      baseUrl: "https://local.example",
      activity: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://victim.example/activities/opt-out",
        type: "Create",
        actor: "https://attacker.example/actor",
      },
      started: new Date().toISOString(),
      attempt: 0,
      identifier: null,
      traceContext: {},
    } satisfies InboxMessage,
  );
  assertEquals(listenerCalls, 1);
  assertEquals(kv.reads, 1);
  assertEquals(kv.writes, 1);
});

test("ContextImpl.getCollectionUri()", () => {
  const federation = new FederationImpl({ kv: new MemoryKvStore() });
  const base = "https://example.com";

  const ctx = new ContextImpl({
    url: new URL(base),
    federation,
    data: undefined,
    documentLoader: mockDocumentLoader,
    contextLoader: documentLoader,
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
    vocab.Object,
    "/string-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(strName, values);
  assertEquals(url.href, `${base}/string-route/123`);

  // Registered with unnamed symbol name
  const unnamedSymName = Symbol(strName);
  federation.setCollectionDispatcher(
    unnamedSymName,
    vocab.Object,
    "/symbol-route/{id}",
    dispatcher,
  );
  url = ctx.getCollectionUri(unnamedSymName, values);
  assertEquals(url.href, `${base}/symbol-route/123`);

  // Registered with named symbol name
  const namedSymName = Symbol.for(strName);
  federation.setCollectionDispatcher(
    namedSymName,
    vocab.Object,
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

test("symbol-named custom collections are served and parsed", async () => {
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const names = [Symbol("bookmarks"), Symbol("bookmarks")];
  const paths = ["bookmarks", "ordered-bookmarks"];
  const calls: Array<[number, string | null]> = [];

  federation.setCollectionDispatcher(
    names[0],
    vocab.Object,
    "/users/{identifier}/bookmarks",
    (_ctx, _values, cursor) => {
      calls.push([0, cursor]);
      return { items: [] };
    },
  );
  federation.setOrderedCollectionDispatcher(
    names[1],
    vocab.Object,
    "/users/{identifier}/ordered-bookmarks",
    (_ctx, _values, cursor) => {
      calls.push([1, cursor]);
      return { items: [] };
    },
  );

  const ctx = federation.createContext(new URL("https://example.com/"));
  for (const [index, name] of names.entries()) {
    const uri = ctx.getCollectionUri(name, { identifier: "alice" });
    assertEquals(uri.pathname, `/users/alice/${paths[index]}`);
    const parsed = ctx.parseUri(uri);
    assertEquals(
      parsed?.type,
      index === 0 ? "collection" : "orderedCollection",
    );
    if (parsed?.type !== "collection" && parsed?.type !== "orderedCollection") {
      throw new Error("Expected a custom collection URI");
    }
    assertStrictEquals(parsed.name, name);
    assertStrictEquals(parsed.class, vocab.Object);
    assertEquals(parsed.typeId, vocab.Object.typeId);
    assertEquals(parsed.values, { identifier: "alice" });

    for (const cursor of [null, "next"]) {
      const pageUri = new URL(uri);
      if (cursor != null) pageUri.searchParams.set("cursor", cursor);
      const response = await federation.fetch(
        new Request(pageUri, {
          headers: { accept: "application/activity+json" },
        }),
        { contextData: undefined },
      );
      assertEquals(response.status, 200);
      const body = await response.json();
      assert(body !== null && typeof body === "object" && "type" in body);
      assertEquals(
        body.type,
        `${index === 0 ? "Collection" : "OrderedCollection"}${
          cursor == null ? "" : "Page"
        }`,
      );
    }
  }
  assertEquals(calls, [[0, null], [0, "next"], [1, null], [1, "next"]]);
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
    let activity = await verifyObject(vocab.Activity, json, options);
    if (activity == null) {
      activity = await vocab.Activity.fromJsonLd(json, options);
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
    allowPrivateAddress: true,
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
        documentLoader: documentLoader,
        contextLoader: documentLoader,
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
        documentLoader: documentLoader,
        contextLoader: documentLoader,
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
      new vocab.Create({
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
        documentLoader: documentLoader,
        contextLoader: documentLoader,
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
        documentLoader: documentLoader,
        contextLoader: documentLoader,
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

test("ContextImpl.sendActivity() honors the private-address policy", async (t) => {
  for (const allowPrivateAddress of [false, true]) {
    await t.step(`allowPrivateAddress: ${allowPrivateAddress}`, async () => {
      const inbox = "http://127.0.0.1/inbox";
      fetchMock.mockGlobal().post(inbox, 202);
      try {
        const federation = createFederation<void>({
          kv: new MemoryKvStore(),
          allowPrivateAddress,
        });
        const ctx = federation.createContext(new URL("https://example.com/"));
        const send = () =>
          ctx.sendActivity(
            { privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! },
            new Person({
              id: new URL("https://example.com/recipient"),
              inbox: new URL(inbox),
            }),
            new Create({
              id: new URL("https://example.com/activity"),
              actor: new URL("https://example.com/person"),
            }),
            { immediate: true },
          );
        if (allowPrivateAddress) {
          await send();
          assertEquals(fetchMock.callHistory.calls(inbox).length, 1);
        } else {
          await assertRejects(send, UrlError);
          assertEquals(fetchMock.callHistory.calls(inbox).length, 0);
        }
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

interface DeferredSignal {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferredSignal(): DeferredSignal {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => resolve = r);
  return { promise, resolve };
}

test("ContextImpl.sendActivity() waits for sibling deliveries on failure", async () => {
  const failingInbox = "http://127.0.0.1:3001/inbox/fail";
  const slowInbox = "http://127.0.0.1:3002/inbox/slow";
  const failingEntered = deferredSignal();
  const slowEntered = deferredSignal();
  const slowCompleted = deferredSignal();
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => releaseSlow = resolve);
  let slowStarted = false;
  let slowSettled = false;

  fetchMock.spyGlobal();
  fetchMock.post(failingInbox, () => {
    failingEntered.resolve();
    return new Response(null, { status: 500 });
  });
  fetchMock.post(slowInbox, async () => {
    slowStarted = true;
    slowEntered.resolve();
    await slowGate;
    slowSettled = true;
    slowCompleted.resolve();
    return new Response(null, { status: 202 });
  });

  let observed: Promise<void> | undefined;
  let released = false;
  try {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const ctx = federation.createContext(new URL("https://example.com/"));
    const activity = new Create({
      id: new URL("https://example.com/activity/fanout"),
      actor: new URL("https://example.com/person"),
    });
    let outerSettled = false;
    let outerError: unknown;
    const sending = ctx.sendActivity(
      [{ privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! }],
      [
        new Person({
          id: new URL("https://example.com/recipients/failing"),
          inbox: new URL(failingInbox),
        }),
        new Person({
          id: new URL("https://example.com/recipients/slow"),
          inbox: new URL(slowInbox),
        }),
      ],
      activity,
      { immediate: true },
    );
    observed = sending.then(
      () => {
        outerSettled = true;
      },
      (error) => {
        outerSettled = true;
        outerError = error;
      },
    );
    await Promise.all([failingEntered.promise, slowEntered.promise]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertFalse(
      outerSettled,
      "sendActivity() must wait for sibling deliveries before rejecting",
    );
    releaseSlow();
    released = true;
    await observed;
    assert(slowSettled, "the delayed delivery should have settled");
    assertInstanceOf(outerError, SendActivityError);
  } finally {
    if (!released) releaseSlow();
    if (slowStarted) await slowCompleted.promise;
    await observed;
    fetchMock.hardReset();
  }
});

test("InboxContextImpl.forwardActivity() waits for sibling deliveries on failure", async () => {
  const failingInbox = "http://127.0.0.1:3003/inbox/fail";
  const slowInbox = "http://127.0.0.1:3004/inbox/slow";
  const failingEntered = deferredSignal();
  const slowEntered = deferredSignal();
  const slowCompleted = deferredSignal();
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => releaseSlow = resolve);
  let slowStarted = false;
  let slowSettled = false;

  fetchMock.spyGlobal();
  fetchMock.post(failingInbox, () => {
    failingEntered.resolve();
    return new Response(null, { status: 500 });
  });
  fetchMock.post(slowInbox, async () => {
    slowStarted = true;
    slowEntered.resolve();
    await slowGate;
    slowSettled = true;
    slowCompleted.resolve();
    return new Response(null, { status: 202 });
  });

  let observed: Promise<void> | undefined;
  let released = false;
  try {
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const activity = await signObject(
      new vocab.Create({
        id: new URL("https://example.com/activity/forward"),
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
        documentLoader: mockDocumentLoader,
        contextLoader: mockDocumentLoader,
      },
    );
    let outerSettled = false;
    let outerError: unknown;
    const sending = ctx.forwardActivity(
      [{ privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! }],
      [
        {
          id: new URL("https://example.com/recipients/failing"),
          inboxId: new URL(failingInbox),
        },
        {
          id: new URL("https://example.com/recipients/slow"),
          inboxId: new URL(slowInbox),
        },
      ],
      { immediate: true, skipIfUnsigned: true },
    );
    observed = sending.then(
      () => {
        outerSettled = true;
      },
      (error) => {
        outerSettled = true;
        outerError = error;
      },
    );
    await Promise.all([failingEntered.promise, slowEntered.promise]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertFalse(
      outerSettled,
      "forwardActivity() must wait for sibling deliveries before rejecting",
    );
    releaseSlow();
    released = true;
    await observed;
    assert(slowSettled, "the delayed delivery should have settled");
    assertInstanceOf(outerError, SendActivityError);
  } finally {
    if (!released) releaseSlow();
    if (slowStarted) await slowCompleted.promise;
    await observed;
    fetchMock.hardReset();
  }
});

test("FederationImpl.sendActivity() drains deliveries when fan-out setup fails", async () => {
  const slowInbox = "http://127.0.0.1:3005/inbox/slow";
  const slowEntered = deferredSignal();
  const slowCompleted = deferredSignal();
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => releaseSlow = resolve);
  let slowStarted = false;
  let slowSettled = false;

  fetchMock.spyGlobal();
  fetchMock.post(slowInbox, async () => {
    slowStarted = true;
    slowEntered.resolve();
    await slowGate;
    slowSettled = true;
    slowCompleted.resolve();
    return new Response(null, { status: 202 });
  });

  let observed: Promise<void> | undefined;
  let released = false;
  try {
    const federation = new FederationImpl<void>({
      kv: new MemoryKvStore(),
      allowPrivateAddress: true,
    });
    const context = federation.createContext(new URL("https://example.com/"));
    const activity = new Create({
      id: new URL("https://example.com/activity/setup-failure"),
      actor: new URL("https://example.com/person"),
    });
    let outerSettled = false;
    let outerError: unknown;
    const sending = federation.sendActivity(
      [{ privateKey: ed25519PrivateKey, keyId: ed25519Multikey.id! }],
      {
        [slowInbox]: {
          actorIds: ["https://example.com/recipients/slow"],
          sharedInbox: false,
        },
        // Synthetic invalid input: the fan-out fails while preparing the
        // second recipient, after the first delivery has already started.
        "not a url": {
          actorIds: ["https://example.com/recipients/invalid"],
          sharedInbox: false,
        },
      },
      activity,
      { context, immediate: true },
    );
    observed = sending.then(
      () => {
        outerSettled = true;
      },
      (error) => {
        outerSettled = true;
        outerError = error;
      },
    );
    await slowEntered.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertFalse(
      outerSettled,
      "sendActivity() must drain started deliveries when fan-out setup fails",
    );
    releaseSlow();
    released = true;
    await observed;
    assert(slowSettled, "the started delivery should have settled");
    assertInstanceOf(outerError, TypeError);
  } finally {
    if (!released) releaseSlow();
    if (slowStarted) await slowCompleted.promise;
    await observed;
    fetchMock.hardReset();
  }
});

test("Federation.fetch() bounds inbox bodies before dispatch", async () => {
  let dispatched = false;
  const json = JSON.stringify({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://example.com/activities/bounded",
    type: "Create",
    actor: "https://example.com/actor",
  });
  const size = 16 * 1024 * 1024;
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    skipSignatureVerification: true,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  federation.setActorDispatcher("/actors/{identifier}", () =>
    new Person({
      id: new URL("https://example.com/actor"),
    }));
  federation.setInboxListeners("/actors/{identifier}/inbox", "/inbox")
    .on(Create, () => {
      dispatched = true;
    });
  for (const contentLength of [undefined, "1", String(size + 1)]) {
    const response = await federation.fetch(
      new Request("https://example.com/inbox", {
        method: "POST",
        headers: contentLength == null
          ? {}
          : { "Content-Length": contentLength },
        body: json.padEnd(size + 1),
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 413);
    assertFalse(dispatched);
  }
  let canceled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      canceled = true;
    },
  }, { highWaterMark: 0 });
  const request = new Request("https://example.com/inbox", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  const rejected = await federation.fetch(request, { contextData: undefined });
  assertEquals(rejected.status, 413);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(canceled);
  assert(pulls <= 260);
  assertFalse(dispatched);
  const accepted = await federation.fetch(
    new Request("https://example.com/inbox", {
      method: "POST",
      body: json,
    }),
    { contextData: undefined },
  );
  assertEquals(accepted.status, 202);
  assert(dispatched);
});

/**
 * Runs the given function while `node:dns/promises`' `lookup()`, which the
 * default public fetch resolves hostnames with, is replaced, so that no test
 * depends on the real DNS.
 */
async function withDnsLookup<T>(
  lookup: (hostname: string) => Promise<unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalLookup = dns.lookup;
  dns.lookup = lookup as typeof dns.lookup;
  try {
    return await fn();
  } finally {
    dns.lookup = originalLookup;
  }
}
