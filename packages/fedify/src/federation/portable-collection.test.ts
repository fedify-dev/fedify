import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  Create,
  lookupObject,
  Note,
  Object as ASObject,
  OrderedCollection,
  Person,
  Tombstone,
  traverseCollection,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  exportDidKey,
  FetchError,
  formatIri,
  parseIri,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { verifyServedPortableObjects } from "../sig/compound-proof.ts";
import { verifyPortableObject } from "../sig/portable-collection.ts";
import { signObject } from "../sig/proof.ts";
import { ed25519PrivateKey, ed25519PublicKey } from "../testing/keys.ts";
import type { Context } from "./context.ts";
import type { Federation } from "./federation.ts";
import { MemoryKvStore } from "./kv.ts";
import { createFederation } from "./middleware.ts";
import { PORTABLE_OBJECT_CONTENT_TYPE } from "./portable.ts";
import { RouterError } from "./router.ts";

const did = await exportDidKey(ed25519PublicKey.publicKey);
const keyId = new URL(`${did}#${did.slice("did:key:".length)}`);
const otherKeyPair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]) as CryptoKeyPair;
const otherDid = await exportDidKey(otherKeyPair.publicKey);
const otherKeyId = new URL(`${otherDid}#${otherDid.slice("did:key:".length)}`);

const ORIGIN = "https://example.com";
const ACCEPT = "application/activity+json";

function gatewayUrl(path: string, authority: string = did): string {
  return `${ORIGIN}/.well-known/apgateway/${authority}${path}`;
}

function portableId(path: string, authority: string = did): string {
  return `ap+ef61://${authority}${path}`;
}

async function fetchJson(
  federation: Federation<void>,
  url: string,
  init: RequestInit = {},
): Promise<[Response, Record<string, unknown> | null]> {
  const response = await federation.fetch(
    new Request(url, {
      ...init,
      headers: { Accept: ACCEPT, ...init.headers },
    }),
    { contextData: undefined },
  );
  const body = await response.text();
  const json = response.headers.get("Content-Type")?.includes("json");
  return [response, body === "" || !json ? null : JSON.parse(body)];
}

async function sign<T extends Note | Person | Create>(
  object: T,
  privateKey: CryptoKey = ed25519PrivateKey,
  key: URL = keyId,
): Promise<T> {
  return await signObject(object, privateKey, key, {
    contextLoader: mockDocumentLoader,
  });
}

/**
 * The DIDs of the actors that this server hosts, which the actor dispatcher
 * looks up by identifier, like an application would in its database.
 */
const users: Record<string, string> = {
  alice: did,
  // Shares the DID with alice, which FEP-ef61 allows:
  bob: did,
  carol: otherDid,
  compatible: did,
  mismatch: did,
  "no-outbox": did,
  https: did,
  tombstone: did,
  "request-did": did,
};

const NOTES_PER_PAGE = 2;
const PAGES = ["0", "1", "2"];

function getNoteValues(identifier: string, cursor: string, index: number) {
  return { id: `${identifier}-${cursor}-${index}` };
}

interface TestFederationOptions {
  readonly inboxDispatcher?: boolean;
  readonly authorize?: boolean;
  readonly calls?: string[];
}

function createTestFederation(options: TestFederationOptions = {}) {
  const calls = options.calls ?? [];
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const noteCache = new Map<string, Note>();
  const getNote = async (ctx: Context<void>, id: string, authority: string) => {
    const key = `${authority} ${id}`;
    let note = noteCache.get(key);
    if (note == null) {
      note = await sign(
        new Note({
          id: ctx.getPortableObjectUri(Note, { id }, authority),
          content: `Note ${id}`,
        }),
        authority === did ? ed25519PrivateKey : otherKeyPair.privateKey,
        authority === did ? keyId : otherKeyId,
      );
      noteCache.set(key, note);
    }
    return note;
  };
  federation
    .setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
      calls.push(`actor ${identifier}`);
      const userDid = users[identifier];
      if (userDid == null) return null;
      switch (identifier) {
        case "https":
          return new Person({
            id: ctx.getActorUri(identifier),
            outbox: ctx.getOutboxUri(identifier),
          });
        case "tombstone":
          return new Tombstone({
            id: ctx.getPortableActorUri(identifier, userDid),
          });
        case "request-did": {
          // A careless dispatcher that takes the DID from the request:
          const authority = ctx.portableRequest?.authority;
          return new Person({
            id: ctx.getPortableActorUri(identifier, authority ?? userDid),
            outbox: ctx.getPortableOutboxUri(identifier, authority ?? userDid),
            gateways: [new URL(ORIGIN)],
          });
        }
        case "compatible": {
          const compatible = (id: URL) => toCompatibleEf61Id(id, ORIGIN);
          return new Person({
            id: compatible(ctx.getPortableActorUri(identifier, userDid)),
            outbox: compatible(ctx.getPortableOutboxUri(identifier, userDid)),
            gateways: [new URL(ORIGIN), new URL("https://other.example")],
          });
        }
      }
      return await sign(
        new Person({
          id: ctx.getPortableActorUri(identifier, userDid),
          preferredUsername: identifier,
          inbox: ctx.getPortableInboxUri(identifier, userDid),
          outbox: identifier === "no-outbox"
            ? null
            : identifier === "mismatch"
            ? ctx.getPortableOutboxUri("alice", userDid)
            : ctx.getPortableOutboxUri(identifier, userDid),
          followers: ctx.getPortableFollowersUri(identifier, userDid),
          featured: ctx.getPortableFeaturedUri(identifier, userDid),
          gateways: [new URL(ORIGIN)],
        }),
        userDid === did ? ed25519PrivateKey : otherKeyPair.privateKey,
        userDid === did ? keyId : otherKeyId,
      );
    });
  const createCache = new Map<string, Create>();
  const getCreate = async (
    ctx: Context<void>,
    id: string,
    authority: string,
  ) => {
    const key = `${authority} ${id}`;
    let create = createCache.get(key);
    if (create == null) {
      create = await sign(
        new Create({
          id: ctx.getPortableObjectUri(Create, { id }, authority),
          actor: ctx.getPortableActorUri("alice", authority),
          object: await getNote(ctx, id, authority),
        }),
        authority === did ? ed25519PrivateKey : otherKeyPair.privateKey,
        authority === did ? keyId : otherKeyId,
      );
      createCache.set(key, create);
    }
    return create;
  };
  federation.setObjectDispatcher(
    Note,
    "/notes/{id}",
    (ctx, values) =>
      ctx.portableRequest == null
        ? null
        : getNote(ctx, values.id, ctx.portableRequest.authority),
  );
  federation.setObjectDispatcher(
    Create,
    "/creates/{id}",
    (ctx, values) =>
      ctx.portableRequest == null
        ? null
        : getCreate(ctx, values.id, ctx.portableRequest.authority),
  );
  const outbox = federation
    .setOutboxDispatcher(
      "/users/{identifier}/outbox",
      async (ctx, identifier, cursor) => {
        calls.push(`outbox ${identifier} ${cursor}`);
        if (cursor == null) return null;
        const authority = users[identifier];
        const items: Create[] = [];
        for (let i = 0; i < NOTES_PER_PAGE; i++) {
          items.push(
            await getCreate(
              ctx,
              getNoteValues(identifier, cursor, i).id,
              authority,
            ),
          );
        }
        const index = PAGES.indexOf(cursor);
        return {
          items,
          prevCursor: index > 0 ? PAGES[index - 1] : null,
          nextCursor: index < PAGES.length - 1 ? PAGES[index + 1] : null,
        };
      },
    )
    .setFirstCursor((_ctx, identifier) => {
      calls.push(`firstCursor ${identifier}`);
      return PAGES[0];
    })
    .setLastCursor(() => PAGES[PAGES.length - 1])
    .setCounter((_ctx, identifier) => {
      calls.push(`counter ${identifier}`);
      return PAGES.length * NOTES_PER_PAGE;
    });
  if (options.authorize) {
    outbox.authorize((ctx, identifier) => {
      calls.push(
        `authorize ${identifier} ${ctx.portableRequest?.authority ?? ""}`,
      );
      return ctx.request.headers.get("X-Allowed") === "yes";
    });
  }
  federation.setFollowersDispatcher(
    "/users/{identifier}/followers",
    (_ctx, _identifier) => ({
      items: [
        { id: new URL("https://a.example/users/1"), inboxId: null },
        { id: new URL("https://b.example/users/2"), inboxId: null },
      ],
    }),
  );
  federation.setFeaturedDispatcher(
    "/users/{identifier}/featured",
    () => ({ items: [] }),
  );
  if (options.inboxDispatcher ?? true) {
    federation.setInboxDispatcher(
      "/users/{identifier}/inbox",
      () => ({ items: [] }),
    );
  }
  federation.setInboxListeners("/users/{identifier}/inbox");
  federation
    .setOrderedCollectionDispatcher(
      "bookmarks",
      Note,
      "/users/{identifier}/bookmarks",
      async (ctx, values, cursor) => {
        calls.push(`bookmarks ${values.identifier} ${cursor}`);
        const authority = users[values.identifier];
        const tag = ctx.url.searchParams.get("tag") ?? "all";
        const note = await getNote(ctx, `${tag}-${cursor ?? "all"}`, authority);
        return {
          items: [note],
          nextCursor: cursor === "0" ? "1" : null,
          prevCursor: cursor === "1" ? "0" : null,
        };
      },
    )
    .setFirstCursor(() => "0")
    .mapPortableOwner((_ctx, values) =>
      values.identifier === "nobody" ? null : values.identifier
    );
  federation.setCollectionDispatcher(
    "drafts",
    Note,
    "/users/{identifier}/drafts",
    () => ({ items: [] }),
  );
  federation
    .setCollectionDispatcher(
      "embedded",
      ASObject,
      "/embedded/{kind}",
      async (ctx, values) => {
        const note = await getNote(ctx, values.kind, did);
        switch (values.kind) {
          case "signed":
            return { items: [note] };
          case "other-did":
            return { items: [await getNote(ctx, "other", otherDid)] };
          case "unsigned":
            return {
              items: [
                new Note({
                  id: ctx.getPortableObjectUri(Note, { id: "u" }, did),
                  content: "Unsigned",
                }),
              ],
            };
          case "tampered":
            return { items: [note.clone({ content: "Tampered" })] };
          case "ordinary":
            return {
              items: [
                new Note({
                  id: new URL("https://example.com/notes/ordinary"),
                  content: "Ordinary",
                }),
              ],
            };
          case "nested": {
            // A signed activity embedding an unsigned portable object:
            const create = await sign(
              new Create({
                id: ctx.getPortableObjectUri(Note, { id: "create" }, did),
                actor: ctx.getPortableActorUri("alice", did),
                object: new Note({
                  id: ctx.getPortableObjectUri(Note, { id: "inner" }, did),
                  content: "Unsigned inner",
                }),
              }),
            );
            return { items: [create] };
          }
          case "replies": {
            // A signed note with an unsigned collection of replies:
            const withReplies = await sign(
              new Note({
                id: ctx.getPortableObjectUri(Note, { id: "replies" }, did),
                content: "Replies",
                replies: new OrderedCollection({
                  id: new URL(
                    ctx.getPortableObjectUri(Note, { id: "replies" }, did)
                      .href + "/replies",
                  ),
                  totalItems: 0,
                }),
              }),
            );
            return { items: [withReplies] };
          }
        }
        return null;
      },
    )
    .mapPortableOwner(() => "alice");
  return federation;
}

test("Federation.fetch() serves portable outboxes", async (t) => {
  const federation = createTestFederation();

  await t.step("collection", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/outbox"),
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Content-Type"),
      PORTABLE_OBJECT_CONTENT_TYPE,
    );
    assertEquals(json?.id, portableId("/users/alice/outbox"));
    assertEquals(json?.type, "OrderedCollection");
    assertEquals(json?.attributedTo, portableId("/users/alice"));
    assertEquals(json?.totalItems, PAGES.length * NOTES_PER_PAGE);
    assertEquals(json?.first, portableId("/users/alice/outbox?cursor=0"));
    assertEquals(json?.last, portableId("/users/alice/outbox?cursor=2"));
  });

  await t.step("pages", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/outbox?cursor=1"),
    );
    assertEquals(response.status, 200);
    assertEquals(json?.id, portableId("/users/alice/outbox?cursor=1"));
    assertEquals(json?.type, "OrderedCollectionPage");
    assertEquals(json?.partOf, portableId("/users/alice/outbox"));
    assertEquals(json?.attributedTo, portableId("/users/alice"));
    assertEquals(json?.prev, portableId("/users/alice/outbox?cursor=0"));
    assertEquals(json?.next, portableId("/users/alice/outbox?cursor=2"));
    const items = json?.orderedItems as Record<string, unknown>[];
    assertEquals(
      items.map((item) => item.id),
      [0, 1].map((i) =>
        portableId(`/creates/${getNoteValues("alice", "1", i).id}`)
      ),
    );
    // The signed items are embedded as they were signed:
    assert(items.every((item) => item.proof != null));
    assert(items.every((item) => item["@context"] != null));
  });

  await t.step("HEAD", async () => {
    const response = await federation.fetch(
      new Request(gatewayUrl("/users/alice/outbox?cursor=0"), {
        method: "HEAD",
        headers: { Accept: ACCEPT },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "");
  });

  await t.step("location hints and other parameters", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl(
        "/users/alice/outbox?cursor=1&@gateway=https%3A%2F%2Fexample.com",
      ),
    );
    assertEquals(response.status, 200);
    assertEquals(json?.id, portableId("/users/alice/outbox?cursor=1"));
    assertEquals(json?.partOf, portableId("/users/alice/outbox"));
  });

  await t.step("actors sharing a DID", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/bob/outbox"),
    );
    assertEquals(response.status, 200);
    assertEquals(json?.id, portableId("/users/bob/outbox"));
    assertEquals(json?.attributedTo, portableId("/users/bob"));
  });

  await t.step("another DID", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/carol/outbox", otherDid),
    );
    assertEquals(response.status, 200);
    assertEquals(json?.id, portableId("/users/carol/outbox", otherDid));
  });

  await t.step("compatible identifiers", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/compatible/outbox"),
    );
    assertEquals(response.status, 200);
    assertEquals(json?.id, gatewayUrl("/users/compatible/outbox"));
    assertEquals(json?.attributedTo, gatewayUrl("/users/compatible"));
    assertEquals(json?.first, gatewayUrl("/users/compatible/outbox?cursor=0"));
  });

  await t.step("not acceptable", async () => {
    const response = await federation.fetch(
      new Request(gatewayUrl("/users/alice/outbox"), {
        headers: { Accept: "text/html" },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 406);
  });
});

test("Federation.fetch() does not serve collections of other DIDs", async (t) => {
  const calls: string[] = [];
  const federation = createTestFederation({ calls });
  const cases: Record<string, string> = {
    "a DID that is not the actor's": gatewayUrl(
      "/users/alice/outbox",
      otherDid,
    ),
    "an actor that is not portable": gatewayUrl("/users/https/outbox"),
    "an actor whose outbox is another": gatewayUrl("/users/mismatch/outbox"),
    "an actor without an outbox": gatewayUrl("/users/no-outbox/outbox"),
    "a deleted actor": gatewayUrl("/users/tombstone/outbox"),
    "an unknown actor": gatewayUrl("/users/unknown/outbox"),
    "an actor dispatcher taking the DID from the request": gatewayUrl(
      "/users/request-did/outbox",
      otherDid,
    ),
    "an unregistered collection": gatewayUrl("/users/alice/liked"),
    "a custom collection without an owner mapper": gatewayUrl(
      "/users/alice/drafts",
    ),
    "a custom collection whose owner mapper returns null": gatewayUrl(
      "/users/nobody/bookmarks",
    ),
    "a custom collection of another DID": gatewayUrl(
      "/users/alice/bookmarks",
      otherDid,
    ),
  };
  for (const [name, url] of Object.entries(cases)) {
    await t.step(name, async () => {
      calls.length = 0;
      const [response] = await fetchJson(federation, url);
      assertEquals(response.status, 404);
      // The collection dispatcher is never called:
      assertFalse(calls.some((call) => call.startsWith("outbox ")));
      assertFalse(calls.some((call) => call.startsWith("bookmarks ")));
    });
  }

  await t.step("malformed DIDs", async () => {
    const [response] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/outbox", "did:key:u" + did.slice(9)),
    );
    assertEquals(response.status, 400);
  });
});

test("Federation.fetch() serves portable inbox collections only with an inbox dispatcher", async () => {
  const federation = createTestFederation();
  const [response, json] = await fetchJson(
    federation,
    gatewayUrl("/users/alice/inbox"),
  );
  assertEquals(response.status, 200);
  assertEquals(json?.id, portableId("/users/alice/inbox"));

  const withoutDispatcher = createTestFederation({ inboxDispatcher: false });
  const [response2] = await fetchJson(
    withoutDispatcher,
    gatewayUrl("/users/alice/inbox"),
  );
  assertEquals(response2.status, 404);
});

test("Federation.fetch() filters portable followers collections", async () => {
  const federation = createTestFederation();
  const [response, json] = await fetchJson(
    federation,
    gatewayUrl(
      "/users/alice/followers?base-url=" +
        encodeURIComponent("https://a.example/path"),
    ),
  );
  assertEquals(response.status, 200);
  assertEquals(
    json?.id,
    portableId(
      "/users/alice/followers?base-url=" +
        encodeURIComponent("https://a.example/"),
    ),
  );
  assertEquals(json?.orderedItems, ["https://a.example/users/1"]);

  // Pages are relative to the same normalized filter as the collection:
  const collectionId = json?.id as string;
  const [pageResponse, page] = await fetchJson(
    federation,
    gatewayUrl(
      "/users/alice/followers?base-url=" +
        encodeURIComponent("https://a.example/path") + "&cursor=0",
    ),
  );
  assertEquals(pageResponse.status, 200);
  assertEquals(page?.id, `${collectionId}&cursor=0`);
  assertEquals(page?.partOf, collectionId);

  // An invalid base-url is dropped from pages too, as from the collection:
  const [invalidResponse, invalidPage] = await fetchJson(
    federation,
    gatewayUrl("/users/alice/followers?base-url=invalid&cursor=0"),
  );
  assertEquals(invalidResponse.status, 200);
  assertEquals(
    invalidPage?.id,
    portableId("/users/alice/followers?cursor=0"),
  );
  assertEquals(invalidPage?.partOf, portableId("/users/alice/followers"));
});

test("Federation.fetch() authorizes portable collection requests", async (t) => {
  const calls: string[] = [];
  const federation = createTestFederation({ authorize: true, calls });

  await t.step("denied", async () => {
    calls.length = 0;
    const [response] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/outbox"),
    );
    assertEquals(response.status, 401);
    // Nothing is dispatched before the request is authorized:
    assertEquals(calls, ["actor alice", `authorize alice ${did}`]);
  });

  await t.step("allowed", async () => {
    calls.length = 0;
    const [response] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/outbox?cursor=0"),
      { headers: { "X-Allowed": "yes" } },
    );
    assertEquals(response.status, 200);
    assertEquals(
      calls.filter((call) => call.startsWith("authorize ")),
      [`authorize alice ${did}`],
    );
  });

  await t.step("a DID that is not the actor's", async () => {
    calls.length = 0;
    const [response] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/outbox", otherDid),
      { headers: { "X-Allowed": "yes" } },
    );
    assertEquals(response.status, 404);
    assertEquals(calls, ["actor alice"]);
  });
});

test("Federation.fetch() serves portable custom collections", async (t) => {
  const federation = createTestFederation();

  await t.step("collection", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/bookmarks?tag=fedify"),
    );
    assertEquals(response.status, 200);
    assertEquals(json?.id, portableId("/users/alice/bookmarks?tag=fedify"));
    assertEquals(json?.attributedTo, portableId("/users/alice"));
    // The filter is kept in the links to the pages:
    assertEquals(
      json?.first,
      portableId("/users/alice/bookmarks?tag=fedify&cursor=0"),
    );
  });

  await t.step("pages", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/bookmarks?tag=fedify&cursor=0"),
    );
    assertEquals(response.status, 200);
    assertEquals(
      json?.id,
      portableId("/users/alice/bookmarks?tag=fedify&cursor=0"),
    );
    assertEquals(json?.partOf, portableId("/users/alice/bookmarks?tag=fedify"));
    assertEquals(
      json?.next,
      portableId("/users/alice/bookmarks?tag=fedify&cursor=1"),
    );
    assertEquals(
      (json?.orderedItems as Record<string, unknown>[])[0].id,
      portableId("/notes/fedify-0"),
    );
  });

  await t.step("compatible identifiers", async () => {
    const [response, json] = await fetchJson(
      federation,
      gatewayUrl("/users/compatible/bookmarks"),
    );
    assertEquals(response.status, 200);
    assertEquals(json?.id, gatewayUrl("/users/compatible/bookmarks"));
    assertEquals(json?.attributedTo, gatewayUrl("/users/compatible"));
  });
});

test("Federation.fetch() applies the proof policy to embedded portable objects", async (t) => {
  const federation = createTestFederation();
  const cases: Record<string, number> = {
    signed: 200,
    "other-did": 200,
    ordinary: 200,
    replies: 200,
    unsigned: 500,
    tampered: 500,
    nested: 500,
  };
  for (const [kind, status] of Object.entries(cases)) {
    await t.step(kind, async () => {
      const [response] = await fetchJson(
        federation,
        gatewayUrl(`/embedded/${kind}`),
      );
      assertEquals(response.status, status);
    });
  }

  await t.step("HEAD", async () => {
    const response = await federation.fetch(
      new Request(gatewayUrl("/embedded/unsigned"), {
        method: "HEAD",
        headers: { Accept: ACCEPT },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 500);
    assertEquals(await response.text(), "");
  });
});

test("Context builds portable collection IDs", async (t) => {
  const federation = createTestFederation();
  const ctx = federation.createContext(new URL(ORIGIN), undefined);
  const helpers: Record<string, [(authority?: string) => URL, string]> = {
    getPortableOutboxUri: [
      (authority) => ctx.getPortableOutboxUri("alice", authority!),
      "/users/alice/outbox",
    ],
    getPortableFollowersUri: [
      (authority) => ctx.getPortableFollowersUri("alice", authority!),
      "/users/alice/followers",
    ],
    getPortableFeaturedUri: [
      (authority) => ctx.getPortableFeaturedUri("alice", authority!),
      "/users/alice/featured",
    ],
    getPortableCollectionUri: [
      (authority) =>
        ctx.getPortableCollectionUri(
          "bookmarks",
          { identifier: "alice" },
          authority!,
        ),
      "/users/alice/bookmarks",
    ],
  };
  for (const [name, [helper, path]] of Object.entries(helpers)) {
    await t.step(name, () => {
      assertEquals(formatIri(helper(did)), portableId(path));
      assertThrows(() => helper(undefined), TypeError);
      assertThrows(() => helper("https://example.com"), TypeError);
    });
  }

  await t.step("unregistered collections", () => {
    assertThrows(() => ctx.getPortableLikedUri("alice", did), RouterError);
    assertThrows(
      () => ctx.getPortableFollowingUri("alice", did),
      RouterError,
    );
    assertThrows(
      () => ctx.getPortableFeaturedTagsUri("alice", did),
      RouterError,
    );
    assertThrows(
      () => ctx.getPortableCollectionUri("unknown", {}, did),
      RouterError,
    );
  });

  await t.step("default authority of RequestContext", async () => {
    const federation = createFederation<void>({
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => mockDocumentLoader,
    });
    const built: string[] = [];
    federation.setActorDispatcher(
      "/users/{identifier}",
      (ctx, identifier) =>
        new Person({
          id: ctx.getPortableActorUri(identifier, did),
          outbox: ctx.getPortableOutboxUri(identifier, did),
        }),
    );
    federation.setOutboxDispatcher(
      "/users/{identifier}/outbox",
      (ctx, identifier) => {
        built.push(formatIri(ctx.getPortableOutboxUri(identifier)));
        return { items: [] };
      },
    );
    const [response] = await fetchJson(
      federation,
      gatewayUrl("/users/alice/outbox"),
    );
    assertEquals(response.status, 200);
    assertEquals(built, [portableId("/users/alice/outbox")]);
    const requestContext = federation.createContext(
      new Request(`${ORIGIN}/`),
      undefined,
    );
    assertThrows(
      () => requestContext.getPortableOutboxUri("alice"),
      TypeError,
    );
  });
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

test("Actor dispatchers warn about mismatching portable collections", async () => {
  const federation = createTestFederation();
  const records = await captureWarnings(async () => {
    for (const identifier of ["alice", "mismatch", "https"]) {
      await fetchJson(federation, `${ORIGIN}/users/${identifier}`);
    }
  });
  const mismatches = records.filter((record) =>
    String(record.rawMessage).includes("does not match the portable ID")
  );
  assertEquals(
    mismatches.map((record) => record.properties.property),
    ["outbox"],
  );
  assertEquals(mismatches[0].properties.value, ctxOutbox("alice"));
});

function ctxOutbox(identifier: string): string {
  // URL#href of a portable ID keeps the DID authority percent-encoded:
  return new URL(
    `ap+ef61://${encodeURIComponent(did)}/users/${identifier}/outbox`,
  ).href;
}

test("Fedify traverses portable collections that Fedify serves", async () => {
  const federation = createTestFederation();
  const loader = (origin: string): DocumentLoader => async (url) => {
    if (!/^https?:/.test(url)) throw new Error(`Not found: ${url}`);
    const target = new URL(url);
    const request = new URL(target.pathname + target.search, ORIGIN);
    const response = await federation.fetch(
      new Request(request, { headers: { Accept: ACCEPT } }),
      { contextData: undefined },
    );
    if (!response.ok) {
      throw new FetchError(url, `HTTP ${response.status}`, response);
    }
    return {
      contextUrl: null,
      documentUrl: new URL(target.pathname + target.search, origin).href,
      document: await response.json(),
    };
  };
  const options = {
    documentLoader: loader(ORIGIN),
    contextLoader: mockDocumentLoader,
    gateways: [ORIGIN],
    verifyPortableObject,
  };
  const actorUri = (gateway: string) =>
    `${portableId("/users/alice")}?@gateway=${encodeURIComponent(gateway)}`;
  const actor = await lookupObject(actorUri(ORIGIN), options);
  assert(actor instanceof Person);
  const outbox = await actor.getOutbox(options);
  assert(outbox instanceof OrderedCollection);
  const items = await Array.fromAsync(traverseCollection(outbox, options));
  assertEquals(
    items.map((item) => item instanceof Create ? formatIri(item.id!) : null),
    PAGES.flatMap((cursor) =>
      [0, 1].map((i) =>
        portableId(`/creates/${getNoteValues("alice", cursor, i).id}`)
      )
    ),
  );

  // Fedify only trusts unsecured collections that the owner lists as its
  // inbox, outbox, followers, following, or liked, so the featured collection
  // is served, but not trusted by Fedify:
  assertEquals(await actor.getFeatured(options), null);

  // The same collection served by a gateway that the actor does not list is
  // not trusted:
  const evil = "https://evil.example";
  const evilOptions = {
    ...options,
    documentLoader: loader(evil),
    gateways: [evil],
  };
  const actor2 = await lookupObject(actorUri(evil), evilOptions);
  assert(actor2 instanceof Person);
  assertEquals(await actor2.getOutbox(evilOptions), null);
});

test("verifyServedPortableObjects() classifies unsigned maps under their effective contexts", async () => {
  const AS = "https://www.w3.org/ns/activitystreams";
  const collection = (member: Record<string, unknown>) => ({
    "@context": AS,
    id: portableId("/collection"),
    type: "OrderedCollection",
    orderedItems: [member],
  });
  // An unsigned portable collection is exempt:
  assertEquals(
    await verifyServedPortableObjects(
      collection({ id: portableId("/replies"), totalItems: 0 }),
    ),
    { verified: true },
  );
  // A mere reference is not checked:
  assertEquals(
    await verifyServedPortableObjects(
      collection({ id: portableId("/notes/1") }),
    ),
    { verified: true },
  );
  // An unsigned portable note is refused:
  assertEquals(
    await verifyServedPortableObjects(
      collection({ id: portableId("/notes/1"), content: "Hi" }),
    ),
    {
      verified: false,
      path: "/orderedItems/0",
      id: portableId("/notes/1"),
      reason: "missingProof",
    },
  );
  // A term that looks like a collection property under the root context but
  // is redefined by an intermediate context:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": { totalItems: `${AS}#content` },
        type: "Note",
        tag: { id: portableId("/notes/2"), totalItems: "Hi" },
      }),
    ),
    {
      verified: false,
      path: "/orderedItems/0/tag",
      id: portableId("/notes/2"),
      reason: "missingProof",
    },
  );
  // Scoped contexts are not supported:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": { tag: { "@id": `${AS}#tag`, "@context": {} } },
        type: "Note",
        tag: { id: portableId("/replies"), totalItems: 0 },
      }),
    ),
    {
      verified: false,
      path: "/orderedItems/0",
      id: "",
      reason: "unsupportedContext",
    },
  );
});

test("verifyServedPortableObjects() verifies embedded maps as they are served", async () => {
  const AS = "https://www.w3.org/ns/activitystreams";
  const note = await sign(
    new Note({ id: parseIri(portableId("/notes/signed")), content: "Hi" }),
  );
  const signed = await note.toJsonLd({
    format: "compact",
    contextLoader: mockDocumentLoader,
  }) as Record<string, unknown>;
  const collection = (member: unknown) => ({
    "@context": AS,
    id: portableId("/collection"),
    type: "OrderedCollection",
    orderedItems: [member],
  });
  assertEquals(
    await verifyServedPortableObjects(collection(signed), {
      contextLoader: mockDocumentLoader,
    }),
    { verified: true },
  );
  // Appending a context that changes the meaning of the signed map is not
  // covered by its proof:
  const context = signed["@context"];
  const swapped = {
    ...signed,
    "@context": [
      ...(Array.isArray(context) ? context : [context]),
      { content: `${AS}#summary` },
    ],
  };
  assertEquals(
    (await verifyServedPortableObjects(collection(swapped), {
      contextLoader: mockDocumentLoader,
    })).verified,
    false,
  );
  // A keyword alias could hide a portable ID from the check:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": { uri: "@id" },
        uri: portableId("/notes/aliased"),
        type: "Note",
        content: "Unsigned",
      }),
    ),
    {
      verified: false,
      path: "/orderedItems/0",
      id: "",
      reason: "unsupportedContext",
    },
  );
});

test("verifyServedPortableObjects() finds portable objects hidden by contexts", async () => {
  const AS = "https://www.w3.org/ns/activitystreams";
  const collection = (member: unknown) => ({
    "@context": AS,
    id: portableId("/collection"),
    type: "OrderedCollection",
    orderedItems: [member],
  });
  // An indirect alias of @id:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": { uri: "id" },
        uri: portableId("/notes/aliased"),
        type: "Note",
        content: "Unsigned",
      }),
    ),
    {
      verified: false,
      path: "",
      id: portableId("/notes/aliased"),
      reason: "hiddenPortableObject",
    },
  );
  // An alias of @id reusing the ID of an exempt map or the root:
  for (
    const decoy of [
      { id: portableId("/notes/decoy"), totalItems: 0 },
      null,
    ]
  ) {
    const id = decoy == null ? portableId("/collection") : decoy.id;
    const document = collection({
      "@context": { uri: "id" },
      uri: id,
      type: "Note",
      content: "Unsigned",
    });
    if (decoy != null) document.orderedItems.push(decoy as never);
    assertEquals(
      await verifyServedPortableObjects(document),
      { verified: false, path: "", id, reason: "hiddenPortableObject" },
    );
  }
  // A redefined proof property:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": { proof: `${AS}#tag` },
        id: "https://example.com/notes/ordinary",
        type: "Note",
        proof: {
          id: portableId("/notes/hidden"),
          type: "Note",
          content: "Unsigned",
        },
      }),
    ),
    {
      verified: false,
      path: "",
      id: portableId("/notes/hidden"),
      reason: "hiddenPortableObject",
    },
  );
});

test("verifyServedPortableObjects() leaves non-portable remote objects alone", async () => {
  const AS = "https://www.w3.org/ns/activitystreams";
  const collection = (member: unknown) => ({
    "@context": AS,
    id: portableId("/collection"),
    type: "OrderedCollection",
    orderedItems: [member],
  });
  // An object embedded as a remote server sent it, e.g., by Mastodon:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": [
          AS,
          {
            toot: "http://joinmastodon.org/ns#",
            focalPoint: { "@container": "@list", "@id": "toot:focalPoint" },
          },
        ],
        id: "https://mastodon.example/users/bob/statuses/1",
        type: "Note",
        content: "<p>AP: Storm hits coast</p>",
      }),
    ),
    { verified: true },
  );
  // A context that is not preloaded may define a prefix that makes
  // a portable ID out of strings that do not look like one:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": [AS, "https://evil.example/context.jsonld"],
        id: "https://evil.example/activities/1",
        type: "Create",
        object: { id: "x:notes/1", type: "Note", content: "Forged" },
      }),
    ),
    {
      verified: false,
      path: "/orderedItems/0",
      id: "https://evil.example/activities/1",
      reason: "unsupportedContext",
    },
  );
  // Inline definitions are known, so a portable prefix defined there counts:
  assertEquals(
    await verifyServedPortableObjects(
      collection({
        "@context": [
          AS,
          { x: { "@id": `ap+ef61://${did}/`, "@prefix": true } },
        ],
        id: "https://example.com/objects/2",
        type: "Note",
        tag: { id: "x:notes/1", type: "Note" },
      }),
    ),
    {
      verified: false,
      path: "/orderedItems/0",
      id: "https://example.com/objects/2",
      reason: "unsupportedContext",
    },
  );
});

test("Federation.fetch() authorizes portable custom collection requests", async () => {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
  });
  const calls: string[] = [];
  federation.setActorDispatcher(
    "/users/{identifier}",
    (ctx, identifier) =>
      new Person({ id: ctx.getPortableActorUri(identifier, did) }),
  );
  federation
    .setCollectionDispatcher(
      "bookmarks",
      Note,
      "/users/{identifier}/bookmarks",
      (_ctx, values) => {
        calls.push(`dispatch ${values.identifier}`);
        return { items: [] };
      },
    )
    .mapPortableOwner((_ctx, values) => values.identifier)
    .authorize((ctx, values) => {
      calls.push(
        `authorize ${values.identifier} ${ctx.portableRequest?.authority}`,
      );
      return ctx.request.headers.get("X-Allowed") === "yes";
    });
  const [denied] = await fetchJson(
    federation,
    gatewayUrl("/users/alice/bookmarks"),
  );
  assertEquals(denied.status, 401);
  assertEquals(calls, [`authorize alice ${did}`]);
  calls.length = 0;
  const [allowed, json] = await fetchJson(
    federation,
    gatewayUrl("/users/alice/bookmarks"),
    { headers: { "X-Allowed": "yes" } },
  );
  assertEquals(allowed.status, 200);
  assertEquals(json?.id, portableId("/users/alice/bookmarks"));
  assertEquals(calls, [`authorize alice ${did}`, "dispatch alice"]);
});
