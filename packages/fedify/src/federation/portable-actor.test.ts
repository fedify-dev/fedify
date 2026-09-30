import {
  createTestMeterProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import { lookupObject, Note, Person, Tombstone } from "@fedify/vocab";
import {
  exportDidKey,
  formatIri,
  fromCompatibleEf61Id,
  toCompatibleEf61Id,
} from "@fedify/vocab-runtime";
import type { ResourceDescriptor } from "@fedify/webfinger";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import {
  assert,
  assertEquals,
  assertFalse,
  assertInstanceOf,
  assertThrows,
} from "@std/assert";
import { signRequest, verifyRequest } from "../sig/http.ts";
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
import type { FederationOptions } from "./federation.ts";
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

async function sign<T extends Person | Note | Tombstone>(
  object: T,
  privateKey: CryptoKey = ed25519PrivateKey,
  key: URL = keyId,
): Promise<T> {
  return await signObject(object, privateKey, key, {
    contextLoader: mockDocumentLoader,
  });
}

/**
 * The DIDs of the users that this server hosts, which the actor dispatcher
 * looks up by identifier, like an application would in its database.
 */
const users: Record<string, string> = {
  alice: did,
  instance: did,
  unsigned: did,
  "wrong-key": did,
  tampered: did,
  https: did,
  tombstone: did,
  "signed-tombstone": did,
  "wrong-key-tombstone": did,
  "mutated-id": did,
  compatible: did,
  "a b/ç": did,
};

async function portableActor(
  ctx: Context<void>,
  identifier: string,
  authority: string,
): Promise<Person> {
  // This server's gateway keys for the actor:
  const keys = await ctx.getActorKeyPairs(identifier);
  return new Person({
    id: ctx.getPortableActorUri(identifier, authority),
    preferredUsername: identifier,
    inbox: ctx.getPortableInboxUri(identifier, authority),
    gateways: [new URL(ORIGIN)],
    publicKeys: keys.map((key) => key.cryptographicKey),
    assertionMethods: keys.map((key) => key.multikey),
  });
}

function createTestFederation(
  options: Partial<FederationOptions<void>> = {},
) {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    documentLoaderFactory: () => mockDocumentLoader,
    contextLoaderFactory: () => mockDocumentLoader,
    ...options,
  });
  const contexts: RequestContext<void>[] = [];
  const setters = federation
    .setActorDispatcher(
      "/users/{identifier}",
      async (ctx, identifier) => {
        contexts.push(ctx);
        const userDid = users[identifier];
        if (userDid == null) return null;
        // The DID in the request path is not evidence that this server hosts
        // the actor for it, so compare it with the stored one:
        if (
          ctx.portableRequest != null &&
          ctx.portableRequest.authority !== userDid
        ) {
          return null;
        }
        switch (identifier) {
          case "https":
            return new Person({ id: ctx.getActorUri(identifier) });
          case "compatible": {
            // Identified by its compatible identifier on the first gateway:
            const actor = await portableActor(ctx, identifier, userDid);
            return await sign(
              actor.clone({ id: toCompatibleEf61Id(actor.id!, ORIGIN) }),
            );
          }
          case "tombstone":
            return new Tombstone({
              id: ctx.getPortableActorUri(identifier, userDid),
            });
          case "signed-tombstone":
            return await sign(
              new Tombstone({
                id: ctx.getPortableActorUri(identifier, userDid),
                formerType: Person,
                deleted: Temporal.Instant.from("2026-01-01T00:00:00Z"),
              }),
            );
          case "wrong-key-tombstone":
            return await sign(
              new Tombstone({
                id: ctx.getPortableActorUri(identifier, userDid),
              }),
              otherKeyPair.privateKey,
              otherKeyId,
            );
          case "unsigned":
            return await portableActor(ctx, identifier, userDid);
          case "wrong-key":
            return await sign(
              await portableActor(ctx, identifier, userDid),
              otherKeyPair.privateKey,
              otherKeyId,
            );
          case "tampered":
            return (await sign(await portableActor(ctx, identifier, userDid)))
              .clone({ name: "Tampered" });
          case "mutated-id": {
            // An actor that keeps its signed JSON-LD, but whose id is changed
            // afterwards, must not be served as the actor in the changed id:
            const signed = await sign(
              await portableActor(ctx, "alice", userDid),
            );
            const actor = await Person.fromJsonLd(
              await signed.toJsonLd({ contextLoader: mockDocumentLoader }),
              {
                contextLoader: mockDocumentLoader,
                documentLoader: mockDocumentLoader,
              },
            );
            actor.id!.pathname = "/users/mutated-id";
            return actor;
          }
        }
        return await sign(await portableActor(ctx, identifier, userDid));
      },
    )
    .setKeyPairsDispatcher(() => [
      { privateKey: rsaPrivateKey2, publicKey: rsaPublicKey2.publicKey! },
    ])
    .mapPortableActorId((ctx, identifier) => {
      const userDid = users[identifier];
      return userDid == null
        ? null
        : ctx.getPortableActorUri(identifier, userDid);
    })
    .mapHandle((_ctx, username) => username)
    .mapActorAlias("/actor", "instance");
  federation.setInboxListeners("/users/{identifier}/inbox", "/inbox");
  return { federation, setters, contexts };
}

test("Context.getPortableActorUri()", async (t) => {
  const { federation } = createTestFederation();
  const ctx = federation.createContext(new URL(`${ORIGIN}/`), undefined);

  await t.step("builds a portable ID from the actor path", () => {
    const uri = ctx.getPortableActorUri("alice", did);
    assertInstanceOf(uri, URL);
    assertEquals(uri.protocol, "ap+ef61:");
    assertEquals(formatIri(uri), `ap+ef61://${did}/users/alice`);
    // The URL class cannot represent the canonical form:
    assertEquals(
      uri.href,
      `ap+ef61://${encodeURIComponent(did)}/users/alice`,
    );
    assertEquals(ctx.getActorUri("alice"), new URL(`${ORIGIN}/users/alice`));
  });

  await t.step("uses the same path as getActorUri()", () => {
    for (const identifier of ["alice", "instance", "a b/ç", "100%"]) {
      assertEquals(
        ctx.getPortableActorUri(identifier, did).pathname,
        ctx.getActorUri(identifier).pathname,
        identifier,
      );
    }
    assertEquals(
      formatIri(ctx.getPortableActorUri("instance", did)),
      `ap+ef61://${did}/actor`,
    );
  });

  await t.step("does not mint a different ID for a dot segment", () => {
    assertThrows(() => ctx.getPortableActorUri("..", did), TypeError);
  });

  await t.step("is serialized in the canonical form", async () => {
    const person = new Person({ id: ctx.getPortableActorUri("alice", did) });
    const json = await person.toJsonLd({
      contextLoader: mockDocumentLoader,
    }) as Record<string, unknown>;
    assertEquals(json.id, `ap+ef61://${did}/users/alice`);
  });

  await t.step("converts to and from compatible identifiers", () => {
    const uri = ctx.getPortableActorUri("a b/ç", did);
    const compatible = toCompatibleEf61Id(uri, ORIGIN);
    assertEquals(
      compatible.href,
      gatewayUrl(ctx.getActorUri("a b/ç").pathname),
    );
    assertEquals(fromCompatibleEf61Id(compatible)?.href, uri.href);
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
        () => ctx.getPortableActorUri("alice", authority),
        TypeError,
        undefined,
        authority,
      );
    }
    assertThrows(
      // @ts-expect-error: Context requires the authority.
      () => ctx.getPortableActorUri("alice"),
      TypeError,
    );
  });

  await t.step("requires an authority outside gateway requests", () => {
    const requestCtx = federation.createContext(
      new Request(`${ORIGIN}/`),
      undefined,
    );
    assertThrows(() => requestCtx.getPortableActorUri("alice"), TypeError);
    assertEquals(
      formatIri(requestCtx.getPortableActorUri("alice", did)),
      `ap+ef61://${did}/users/alice`,
    );
  });

  await t.step("requires an actor dispatcher", () => {
    const empty = createFederation<void>({ kv: new MemoryKvStore() });
    const emptyCtx = empty.createContext(new URL(`${ORIGIN}/`), undefined);
    assertThrows(
      () => emptyCtx.getPortableActorUri("alice", did),
      RouterError,
    );
  });
});

test("Context portable ID helpers require base58-btc did:key DIDs", async (t) => {
  const { federation } = createTestFederation();
  federation.setObjectDispatcher(Note, "/notes/{id}", () => null);
  const ctx = federation.createContext(new URL(`${ORIGIN}/`), undefined);
  const helpers: Record<string, (authority: string) => URL> = {
    getPortableActorUri: (authority) =>
      ctx.getPortableActorUri("alice", authority),
    getPortableObjectUri: (authority) =>
      ctx.getPortableObjectUri(Note, { id: "1" }, authority),
    getPortableInboxUri: (authority) =>
      ctx.getPortableInboxUri("alice", authority),
  };
  const base64url = `did:key:u${did.slice("did:key:z".length)}`;
  for (const [name, helper] of Object.entries(helpers)) {
    await t.step(name, () => {
      for (
        const authority of [
          base64url,
          base64url.replace("did:key:", "DID:KEY:"),
          `did:key:%75${did.slice("did:key:z".length)}`,
          "did:key:z",
          "did:key:z0OIl",
        ]
      ) {
        assertThrows(() => helper(authority), TypeError, undefined, authority);
      }
      assertEquals(
        formatIri(helper(did)).startsWith(`ap+ef61://${did}/`),
        true,
      );
      // The scheme and the method are case-insensitive:
      assertEquals(
        formatIri(helper(did.replace("did:key:", "DID:KEY:"))),
        formatIri(helper(did)),
      );
      // Other DID methods are only checked for their syntax:
      assertEquals(
        formatIri(helper("did:web:example.com")).startsWith(
          "ap+ef61://did:web:example.com/",
        ),
        true,
      );
    });
  }
});

test("RequestContext.getPortableActorUri() in gateway requests", async () => {
  const { federation, contexts } = createTestFederation();
  const response = await federation.fetch(gatewayRequest("/users/alice"), {
    contextData: undefined,
  });
  assertEquals(response.status, 200);
  const ctx = contexts[0];
  assertEquals(ctx.portableRequest?.authority, did);
  // Defaults to the requested DID:
  assertEquals(
    formatIri(ctx.getPortableActorUri("alice")),
    `ap+ef61://${did}/users/alice`,
  );
  // An explicit authority takes precedence:
  assertEquals(
    formatIri(ctx.getPortableActorUri("alice", otherDid)),
    `ap+ef61://${otherDid}/users/alice`,
  );
});

test("Federation.fetch() serves portable actors through the actor dispatcher", async (t) => {
  const { federation, contexts } = createTestFederation();

  await t.step("serves a portable actor", async () => {
    contexts.length = 0;
    const response = await federation.fetch(gatewayRequest("/users/alice"), {
      contextData: undefined,
    });
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Content-Type"),
      PORTABLE_OBJECT_CONTENT_TYPE,
    );
    const json = await response.json() as Record<string, unknown>;
    assertEquals(json.id, `ap+ef61://${did}/users/alice`);
    assertEquals(json.inbox, `ap+ef61://${did}/users/alice/inbox`);
    const verified = await verifyPortableObjectProof(json, {
      contextLoader: mockDocumentLoader,
    });
    assertEquals(verified.verified, true);
    assertEquals(contexts.length, 1);
    assertEquals(contexts[0].portableRequest?.authority, did);
    assertEquals(
      formatIri(contexts[0].portableRequest!.id),
      `ap+ef61://${did}/users/alice`,
    );
  });

  await t.step("serves an actor with a compatible identifier", async () => {
    const response = await federation.fetch(
      gatewayRequest("/users/compatible"),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    const json = await response.json() as Record<string, unknown>;
    assertEquals(json.id, gatewayUrl("/users/compatible"));
  });

  await t.step("serves an actor with reserved characters", async () => {
    const ctx = federation.createContext(new URL(`${ORIGIN}/`), undefined);
    const response = await federation.fetch(
      gatewayRequest(ctx.getActorUri("a b/ç").pathname),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
  });

  await t.step("serves an actor alias", async () => {
    let response = await federation.fetch(gatewayRequest("/actor"), {
      contextData: undefined,
    });
    assertEquals(response.status, 200);
    assertEquals(
      ((await response.json()) as { id: string }).id,
      `ap+ef61://${did}/actor`,
    );
    // The actor's ID names the alias, not the primary path:
    response = await federation.fetch(gatewayRequest("/users/instance"), {
      contextData: undefined,
    });
    assertEquals(response.status, 404);
  });

  await t.step(
    "responds with 400 for non-base58-btc did:key DIDs",
    async () => {
      contexts.length = 0;
      const base64url = `did:key:u${did.slice("did:key:z".length)}`;
      for (const method of ["GET", "POST"]) {
        const response = await federation.fetch(
          gatewayRequest(
            method === "GET" ? "/users/alice" : "/users/alice/inbox",
            {
              method,
              authority: base64url,
              ...(method === "POST" ? { body: "{}" } : {}),
            },
          ),
          { contextData: undefined },
        );
        assertEquals(response.status, 400, method);
      }
      assertEquals(contexts.length, 0);
    },
  );

  await t.step("responds to HEAD without a body", async () => {
    const response = await federation.fetch(
      gatewayRequest("/users/alice", { method: "HEAD" }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(
      response.headers.get("Content-Type"),
      PORTABLE_OBJECT_CONTENT_TYPE,
    );
    assertEquals(response.body, null);
  });

  await t.step(
    "responds with 406 without a JSON-LD Accept header",
    async () => {
      let notAcceptable = false;
      const response = await federation.fetch(
        gatewayRequest("/users/alice", { headers: { Accept: "text/html" } }),
        {
          contextData: undefined,
          onNotAcceptable() {
            notAcceptable = true;
            return new Response("Not acceptable", { status: 406 });
          },
        },
      );
      assertEquals(response.status, 406);
      assertEquals(notAcceptable, true);
    },
  );

  await t.step("responds with 404 for actors it does not serve", async () => {
    for (
      const request of [
        // The dispatcher returns null:
        gatewayRequest("/users/missing"),
        // The dispatcher returns an actor with an HTTPS ID:
        gatewayRequest("/users/https"),
        // The dispatcher returns an unsigned tombstone:
        gatewayRequest("/users/tombstone"),
        gatewayRequest("/users/tombstone", { method: "HEAD" }),
        // This server does not host the actor for the other DID:
        gatewayRequest("/users/alice", { authority: otherDid }),
        // The serialized actor has another ID:
        gatewayRequest("/users/mutated-id"),
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
      assertEquals(response.status, 404, request.url);
      assertEquals(notFound, true, request.url);
    }
  });

  await t.step("refuses actors that violate the proof policy", async () => {
    for (
      const identifier of [
        "unsigned",
        "wrong-key",
        "tampered",
        "wrong-key-tombstone",
      ]
    ) {
      const response = await federation.fetch(
        gatewayRequest(`/users/${identifier}`),
        { contextData: undefined },
      );
      assertEquals(response.status, 500, identifier);
      assertEquals(await response.text(), "Internal server error.");
    }
  });

  await t.step("serves a signed tombstone with 410 Gone", async () => {
    const response = await federation.fetch(
      gatewayRequest("/users/signed-tombstone"),
      { contextData: undefined },
    );
    assertEquals(response.status, 410);
    assertEquals(
      response.headers.get("Content-Type"),
      PORTABLE_OBJECT_CONTENT_TYPE,
    );
    assertEquals(response.headers.get("Vary"), "Accept");
    const json = await response.json() as Record<string, unknown>;
    assertEquals(json.type, "Tombstone");
    assertEquals(json.id, `ap+ef61://${did}/users/signed-tombstone`);
    assertEquals(json.deleted, "2026-01-01T00:00:00Z");
    const verified = await verifyPortableObjectProof(json, {
      contextLoader: mockDocumentLoader,
    });
    assertEquals(verified.verified, true);
  });

  await t.step("responds to HEAD for a tombstone without a body", async () => {
    const response = await federation.fetch(
      gatewayRequest("/users/signed-tombstone", { method: "HEAD" }),
      { contextData: undefined },
    );
    assertEquals(response.status, 410);
    assertEquals(
      response.headers.get("Content-Type"),
      PORTABLE_OBJECT_CONTENT_TYPE,
    );
    assertEquals(response.body, null);
  });

  await t.step("keeps ordinary tombstone requests unchanged", async () => {
    const response = await federation.fetch(
      new Request(`${ORIGIN}/users/signed-tombstone`, {
        headers: { Accept: ACCEPT },
      }),
      { contextData: undefined },
    );
    assertEquals(response.status, 410);
    assertEquals(
      response.headers.get("Content-Type"),
      "application/activity+json",
    );
  });

  await t.step("keeps ordinary actor requests unchanged", async () => {
    const response = await federation.fetch(
      new Request(`${ORIGIN}/users/https`, { headers: { Accept: ACCEPT } }),
      { contextData: undefined },
    );
    assertEquals(response.status, 200);
    assertEquals(
      ((await response.json()) as { id: string }).id,
      `${ORIGIN}/users/https`,
    );
  });

  await t.step("leaves POST requests to the actor path alone", async () => {
    let notFound = false;
    const response = await federation.fetch(
      gatewayRequest("/users/alice", { method: "POST", body: "{}" }),
      {
        contextData: undefined,
        onNotFound() {
          notFound = true;
          return new Response("Not found", { status: 404 });
        },
      },
    );
    assertEquals(response.status, 404);
    assertEquals(notFound, true);
  });
});

test("Federation.fetch() authorizes portable actor requests", async (t) => {
  const { federation, setters } = createTestFederation();
  const identifiers: string[] = [];
  setters.authorize(async (ctx, identifier) => {
    identifiers.push(identifier);
    assertEquals(ctx.portableRequest?.authority, did);
    const owner = await ctx.getSignedKeyOwner();
    return owner?.id?.href === "https://example.com/person2";
  });

  await t.step("allows a signed request", async () => {
    const request = await signRequest(
      gatewayRequest("/users/alice?x=1"),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    const response = await federation.fetch(request, {
      contextData: undefined,
    });
    assertEquals(response.status, 200);
    assertEquals(identifiers, ["alice"]);
  });

  await t.step("denies an unsigned request", async () => {
    let unauthorized = false;
    const response = await federation.fetch(gatewayRequest("/users/alice"), {
      contextData: undefined,
      onUnauthorized() {
        unauthorized = true;
        return new Response("Unauthorized", { status: 401 });
      },
    });
    assertEquals(response.status, 401);
    assertEquals(unauthorized, true);
  });

  await t.step("authorizes before serving a tombstone", async () => {
    for (const identifier of ["signed-tombstone", "tombstone"]) {
      identifiers.length = 0;
      let unauthorized = false;
      const response = await federation.fetch(
        gatewayRequest(`/users/${identifier}`),
        {
          contextData: undefined,
          onUnauthorized() {
            unauthorized = true;
            return new Response("Unauthorized", { status: 401 });
          },
        },
      );
      assertEquals(response.status, 401, identifier);
      assertEquals(unauthorized, true, identifier);
      assertEquals(identifiers, [identifier]);
    }
  });

  await t.step("denies a request whose target was tampered with", async () => {
    const signed = await signRequest(
      gatewayRequest("/users/alice"),
      rsaPrivateKey3,
      rsaPublicKey3.id!,
    );
    const response = await federation.fetch(
      new Request(gatewayUrl("/actor"), { headers: signed.headers }),
      { contextData: undefined },
    );
    assertEquals(response.status, 401);
  });
});

test("Federation.fetch() serves portable actors found through WebFinger", async () => {
  const { federation } = createTestFederation();
  const webFinger = await federation.fetch(
    new Request(
      `${ORIGIN}/.well-known/webfinger?resource=acct:alice@example.com`,
    ),
    { contextData: undefined },
  );
  assertEquals(webFinger.status, 200);
  const jrd: ResourceDescriptor = await webFinger.json();
  assertEquals(jrd.subject, "acct:alice@example.com");
  assertEquals(jrd.links?.[0], {
    rel: "self",
    href: gatewayUrl("/users/alice"),
    type: "application/activity+json",
  });
  const actor = await lookupObject(jrd.links![0].href!, {
    documentLoader: federationLoader(federation),
    contextLoader: mockDocumentLoader,
    verifyPortableObject: verifyPortableObjectProof,
  });
  assertInstanceOf(actor, Person);
  assertEquals(formatIri(actor.id!), `ap+ef61://${did}/users/alice`);
});

function federationLoader(
  federation: ReturnType<typeof createTestFederation>["federation"],
) {
  return async (url: string) => {
    // Fragments are not sent to servers:
    const response = await federation.fetch(
      new Request(url.replace(/#.*$/, ""), { headers: { Accept: ACCEPT } }),
      { contextData: undefined },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return {
      contextUrl: null,
      documentUrl: url,
      document: await response.json(),
    };
  };
}

test("Gateway keys of portable actors dereference to the actor dispatcher", async (t) => {
  for (
    const [label, options] of [
      ["default origin", {}],
      ["canonical origin", { origin: ORIGIN }],
    ] as const
  ) {
    await t.step(label, async () => {
      const { federation } = createTestFederation(options);
      // A request to another host name, e.g., behind a reverse proxy:
      const ctx = federation.createContext(
        new URL(
          "origin" in options ? "https://internal.example/" : `${ORIGIN}/`,
        ),
        undefined,
      );
      for (const identifier of ["alice", "instance"]) {
        const [keyPair] = await ctx.getActorKeyPairs(identifier);
        assertEquals(
          keyPair.keyId.href,
          `${
            toCompatibleEf61Id(
              ctx.getPortableActorUri(identifier, did),
              ORIGIN,
            ).href
          }#main-key`,
        );
        const request = await signRequest(
          new Request("https://recipient.example/inbox", {
            method: "POST",
            body: "{}",
            headers: { "Content-Type": "application/activity+json" },
          }),
          keyPair.privateKey,
          keyPair.keyId,
        );
        const key = await verifyRequest(request, {
          documentLoader: federationLoader(federation),
          contextLoader: mockDocumentLoader,
        });
        assert(key != null, identifier);
        assertEquals(key.id?.href, keyPair.keyId.href);
        assertEquals(
          key.ownerId?.href,
          ctx.getPortableActorUri(identifier, did).href,
        );
      }
    });
  }
});

test("Federation.fetch() records metrics for portable actor requests", async () => {
  const [meterProvider, recorder] = createTestMeterProvider();
  const { federation } = createTestFederation({ meterProvider });
  let response = await federation.fetch(gatewayRequest("/users/alice"), {
    contextData: undefined,
  });
  assertEquals(response.status, 200);
  let counts = recorder.getMeasurements("fedify.http.server.request.count");
  assertEquals(counts.length, 1);
  assertEquals(counts[0].attributes["fedify.endpoint"], "actor");
  const template = counts[0].attributes["fedify.route.template"];
  assertEquals(template, "/.well-known/apgateway/{did}/users/{identifier}");

  response = await federation.fetch(
    gatewayRequest("/users/alice", { headers: { Accept: "text/html" } }),
    { contextData: undefined },
  );
  assertEquals(response.status, 406);
  counts = recorder.getMeasurements("fedify.http.server.request.count");
  assertEquals(counts.length, 2);
  assertEquals(counts[1].attributes["fedify.endpoint"], "not_acceptable");
});

test("Federation.fetch() warns about recursive actor dispatches in gateway requests", async () => {
  const records: LogRecord[] = [];
  await reset();
  try {
    await configure({
      sinks: { buffer: (record: LogRecord) => records.push(record) },
      filters: {},
      loggers: [
        { category: ["fedify", "federation", "actor"], sinks: ["buffer"] },
        { category: ["logtape", "meta"], sinks: [], lowestLevel: "warning" },
      ],
    });
    const { federation } = createTestFederation();
    // Getting key pairs, as the dispatcher does, is not recursive:
    let response = await federation.fetch(gatewayRequest("/users/alice"), {
      contextData: undefined,
    });
    assertEquals(response.status, 200);
    const isRecursionWarning = (record: LogRecord) =>
      record.level === "warning" &&
      record.rawMessage.toString().includes("infinite loop");
    assertFalse(records.some(isRecursionWarning));

    const recursive = createFederation<void>({
      kv: new MemoryKvStore(),
      documentLoaderFactory: () => mockDocumentLoader,
      contextLoaderFactory: () => mockDocumentLoader,
    });
    recursive.setActorDispatcher(
      "/users/{identifier}",
      async (ctx, identifier) => {
        if (identifier === "alice") await ctx.getActor("bob");
        return null;
      },
    );
    response = await recursive.fetch(gatewayRequest("/users/alice"), {
      contextData: undefined,
    });
    assertEquals(response.status, 404);
    assert(records.some(isRecursionWarning));
  } finally {
    await reset();
  }
});
