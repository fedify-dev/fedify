import { mockDocumentLoader, test } from "@fedify/fixture";
import {
  type DocumentLoader,
  FetchError,
  parseIri,
  type PortableObjectVerifier,
  type PortableObjectVerifierOptions,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import fetchMock from "fetch-mock";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { getActorHandle } from "./actor.ts";
import { lookupObject } from "./lookup.ts";
import { assertInstanceOf } from "./utils.ts";
import { Person } from "./vocab.ts";

const did = "did:key:z6Mkabc";
const actorId = `ap+ef61://${did}/actor`;
const gatewayPath = `/.well-known/apgateway/${did}/actor`;
const compatibleId = `https://example.com${gatewayPath}`;
const webFingerPrefix = "begin:https://example.com/.well-known/webfinger";
const AS_TYPE = "application/activity+json";

function person(
  id: string = `ap://${did}/actor`,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: "Person",
    name: "Alice",
    ...extra,
  };
}

function createLoader(
  responses: Record<string, Record<string, unknown>>,
): DocumentLoader & { readonly fetched: string[] } {
  const fetched: string[] = [];
  // deno-lint-ignore require-await
  const loader = async (
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteDocument> => {
    fetched.push(url);
    options?.signal?.throwIfAborted();
    const document = responses[url];
    if (document == null) {
      throw new FetchError(
        url,
        "HTTP 404",
        new globalThis.Response(null, { status: 404 }),
      );
    }
    return { contextUrl: null, documentUrl: url, document };
  };
  return Object.assign(loader, { fetched });
}

function createVerifier(
  verified = true,
): PortableObjectVerifier & { readonly documents: unknown[] } {
  const documents: unknown[] = [];
  // deno-lint-ignore require-await
  const verifier = async (document: unknown) => {
    documents.push(document);
    return { verified };
  };
  return Object.assign(verifier, { documents });
}

function selfLinks(...hrefs: string[]) {
  return {
    subject: "acct:alice@example.com",
    links: hrefs.map((href) => ({ rel: "self", type: AS_TYPE, href })),
  };
}

test("lookupObject() with FEP-ef61 portable actors", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  fetchMock.spyGlobal();
  try {
    await t.step("compatible self link, alias-free JRD", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, selfLinks(compatibleId));
      const document = person();
      const documentLoader = createLoader({ [compatibleId]: document });
      const verifyPortableObject = createVerifier();
      const actor = await lookupObject("@alice@example.com", {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject,
      });
      assertInstanceOf(actor, Person);
      deepStrictEqual(actor.id, parseIri(actorId));
      deepStrictEqual(documentLoader.fetched, [compatibleId]);
      deepStrictEqual(verifyPortableObject.documents, [document]);
    });

    await t.step(
      "canonical self link asks the WebFinger host first",
      async () => {
        fetchMock.removeRoutes();
        fetchMock.get(webFingerPrefix, {
          subject: "acct:alice@example.com",
          links: [{
            rel: "self",
            type:
              'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
            href: `ap://${did}/actor?@gateway=https%3A%2F%2Fhint.example`,
          }],
        });
        const hinted = `https://hint.example${gatewayPath}`;
        const documentLoader = createLoader({ [hinted]: person() });
        const actor = await lookupObject("@alice@example.com", {
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(),
        });
        assertInstanceOf(actor, Person);
        deepStrictEqual(documentLoader.fetched, [compatibleId, hinted]);
      },
    );

    await t.step("explicit gateways replace WebFinger hints", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        webFingerPrefix,
        selfLinks(
          `ap://${did}/actor?@gateway=https%3A%2F%2Fhint.example`,
        ),
      );
      const second = `https://second.example${gatewayPath}`;
      const documentLoader = createLoader({ [second]: person() });
      const actor = await lookupObject("@alice@example.com", {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
        gateways: ["https://second.example"],
      });
      assertInstanceOf(actor, Person);
      deepStrictEqual(documentLoader.fetched, [compatibleId, second]);
    });

    await t.step("WebFinger host counts toward the five attempts", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, selfLinks(`ap://${did}/actor`));
      const documentLoader = createLoader({});
      equal(
        await lookupObject("@alice@example.com", {
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(),
          gateways: Array.from(
            { length: 6 },
            (_, i) => `https://g${i}.example`,
          ),
        }),
        null,
      );
      deepStrictEqual(documentLoader.fetched, [
        compatibleId,
        ...[0, 1, 2, 3].map((i) => `https://g${i}.example${gatewayPath}`),
      ]);
    });

    await t.step("tries the next self link after a failure", async () => {
      fetchMock.removeRoutes();
      const other = `https://other.example${gatewayPath}`;
      fetchMock.get(
        webFingerPrefix,
        selfLinks(`ap://${did}/actor`, compatibleId, other),
      );
      const documentLoader = createLoader({ [other]: person() });
      const actor = await lookupObject("@alice@example.com", {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      });
      assertInstanceOf(actor, Person);
      // The same gateway is not asked twice for the same portable ID:
      deepStrictEqual(documentLoader.fetched, [compatibleId, other]);
    });

    await t.step("accepts a compatible identifier as the ID", async () => {
      // Some publishers, e.g., tootik, identify their portable actors by
      // compatible identifiers; the document is verified as the portable
      // object, and keeps its own ID:
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, selfLinks(compatibleId));
      const document = person(compatibleId);
      const documentLoader = createLoader({ [compatibleId]: document });
      const verifyPortableObject = createVerifier();
      const actor = await lookupObject("@alice@example.com", {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject,
      });
      assertInstanceOf(actor, Person);
      deepStrictEqual(actor.id, new URL(compatibleId));
      deepStrictEqual(verifyPortableObject.documents, [document]);
    });

    await t.step("rejects objects that fail the checks", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, selfLinks(compatibleId));
      for (
        const [document, verified] of [
          [person(), false],
          // Same DID, but another object:
          [person(`ap://${did}/other`), true],
          // A compatible identifier of another object:
          [
            person(`https://example.com/.well-known/apgateway/${did}/other`),
            true,
          ],
          // A compatible identifier of the object, but unverified:
          [person(compatibleId), false],
        ] as const
      ) {
        const documentLoader = createLoader({ [compatibleId]: document });
        const verifyPortableObject = createVerifier(verified);
        equal(
          await lookupObject("@alice@example.com", {
            documentLoader,
            contextLoader: mockDocumentLoader,
            verifyPortableObject,
          }),
          null,
        );
        // No fallback to fetching the compatible identifier as an ordinary
        // HTTPS URL:
        deepStrictEqual(documentLoader.fetched, [compatibleId]);
        await rejects(
          () =>
            lookupObject("@alice@example.com", {
              documentLoader,
              contextLoader: mockDocumentLoader,
              verifyPortableObject,
              crossOrigin: "throw",
            }),
          { name: "PortableObjectRejectedError" },
        );
        equal(
          await lookupObject("@alice@example.com", {
            documentLoader,
            contextLoader: mockDocumentLoader,
            verifyPortableObject,
            crossOrigin: "trust",
          }),
          null,
        );
      }
    });

    await t.step("without verifyPortableObject", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        webFingerPrefix,
        selfLinks(`ap://${did}/actor`, compatibleId),
      );
      const documentLoader = createLoader({ [compatibleId]: person() });
      for (const crossOrigin of ["ignore", "trust"] as const) {
        // The canonical link is skipped, and the compatible identifier is
        // fetched as an ordinary URL, but its portable object is refused:
        equal(
          await lookupObject("@alice@example.com", {
            documentLoader,
            contextLoader: mockDocumentLoader,
            crossOrigin,
          }),
          null,
        );
      }
      deepStrictEqual(documentLoader.fetched, [compatibleId, compatibleId]);
      await rejects(
        () =>
          lookupObject("@alice@example.com", {
            documentLoader,
            contextLoader: mockDocumentLoader,
            crossOrigin: "throw",
          }),
        /has a different origin than the document URL/,
      );

      // An object with an ordinary ID served at a compatible identifier
      // keeps working as before:
      const httpLoader = createLoader({ [compatibleId]: person(compatibleId) });
      const actor = await lookupObject("@alice@example.com", {
        documentLoader: httpLoader,
        contextLoader: mockDocumentLoader,
      });
      assertInstanceOf(actor, Person);
      deepStrictEqual(actor.id, new URL(compatibleId));

      const malformed = `${compatibleId}?gateways=x`;
      const ordinaryLoader = createLoader({
        [malformed]: person(malformed),
      });
      const ordinary = await lookupObject(malformed, {
        documentLoader: ordinaryLoader,
        contextLoader: mockDocumentLoader,
      });
      assertInstanceOf(ordinary, Person);
      deepStrictEqual(ordinaryLoader.fetched, [malformed]);
    });

    await t.step("refuses portable IRIs changed by URL parsing", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        webFingerPrefix,
        selfLinks(
          `ap://${did}/x/../actor`,
          `ap://${did}/x/%2e%2e/actor`,
        ),
      );
      const documentLoader = createLoader({ [compatibleId]: person() });
      const options = {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      };
      equal(await lookupObject("@alice@example.com", options), null);
      equal(
        await lookupObject(
          `ap://${did}/x/../actor?@gateway=https%3A%2F%2Fexample.com`,
          options,
        ),
        null,
      );
      deepStrictEqual(documentLoader.fetched, []);
    });

    await t.step("refuses compatible IDs changed by URL parsing", async () => {
      fetchMock.removeRoutes();
      const dotted = compatibleId.replace("/actor", "/x/../actor");
      const documentLoader = createLoader({ [compatibleId]: person() });
      const options = {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      };
      equal(await lookupObject(dotted, options), null);
      fetchMock.get(webFingerPrefix, selfLinks(dotted));
      equal(await lookupObject("@alice@example.com", options), null);
      deepStrictEqual(documentLoader.fetched, []);
    });

    await t.step("bounds gateway requests", async () => {
      fetchMock.removeRoutes();
      const hints = Array.from(
        { length: 5 },
        (_, i) => `@gateway=https%3A%2F%2Fg${i}.example`,
      ).join("&");
      fetchMock.get(
        webFingerPrefix,
        selfLinks(
          `ap://${did}/actor?${hints}`,
          `ap://${did}/actor2?${hints}`,
          `https://g9.example/.well-known/apgateway/${did}/actor`,
        ),
      );
      const documentLoader = createLoader({});
      equal(
        await lookupObject("@alice@example.com", {
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(),
        }),
        null,
      );
      deepStrictEqual(documentLoader.fetched, [
        compatibleId,
        ...[0, 1, 2, 3].map((i) => `https://g${i}.example${gatewayPath}`),
      ]);
    });

    await t.step("cancellation", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        webFingerPrefix,
        selfLinks(
          `ap://${did}/actor`,
          `https://other.example${gatewayPath}`,
        ),
      );
      const controller = new AbortController();
      const verifyPortableObject: PortableObjectVerifier = () => {
        controller.abort();
        return Promise.resolve({ verified: true });
      };
      const documentLoader = createLoader({ [compatibleId]: person() });
      equal(
        await lookupObject("@alice@example.com", {
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject,
          signal: controller.signal,
        }),
        null,
      );
      deepStrictEqual(documentLoader.fetched, [compatibleId]);
    });
  } finally {
    fetchMock.removeRoutes();
    fetchMock.hardReset();
  }
});

test("lookupObject() looks up portable identifiers directly", async () => {
  const verifyPortableObject = createVerifier();
  const hinted = `https://gw.example${gatewayPath}`;
  const documentLoader = createLoader({
    [hinted]: person(),
    [`https://example.com${gatewayPath}`]: person(),
    [actorId]: person(),
  });
  const options = {
    documentLoader,
    contextLoader: mockDocumentLoader,
    verifyPortableObject,
  };
  for (
    const identifier of [
      `ap://${did}/actor?@gateway=https%3A%2F%2Fgw.example`,
      compatibleId,
      new URL(compatibleId),
      // Without hints, the document loader gets the portable ID itself:
      `ap://${did}/actor`,
      parseIri(`ap://${did}/actor`),
    ]
  ) {
    const actor = await lookupObject(identifier, options);
    assertInstanceOf(actor, Person);
    deepStrictEqual(actor.id, parseIri(actorId));
  }
  deepStrictEqual(documentLoader.fetched, [
    hinted,
    compatibleId,
    compatibleId,
    actorId,
    actorId,
  ]);
  // Portable identifiers are not looked up without a verifier:
  equal(
    await lookupObject(`ap://${did}/actor`, {
      documentLoader,
      contextLoader: mockDocumentLoader,
    }),
    null,
  );
  deepStrictEqual(documentLoader.fetched.length, 5);
});

test("lookupObject() uses explicit gateways for portable IDs", async (t) => {
  const first = `https://first.example${gatewayPath}`;
  const second = `https://second.example${gatewayPath}`;
  const hint = `https://hint.example${gatewayPath}`;
  const options = {
    contextLoader: mockDocumentLoader,
    verifyPortableObject: createVerifier(),
  };

  await t.step("bare ap: ID and one gateway", async () => {
    const documentLoader = createLoader({ [first]: person() });
    assertInstanceOf(
      await lookupObject(`ap://${did}/actor`, {
        ...options,
        documentLoader,
        gateways: ["https://first.example"],
      }),
      Person,
    );
    deepStrictEqual(documentLoader.fetched, [first]);
  });

  await t.step("tries several gateways in order", async () => {
    const documentLoader = createLoader({ [second]: person() });
    assertInstanceOf(
      await lookupObject(actorId, {
        ...options,
        documentLoader,
        gateways: ["https://first.example", new URL("https://second.example")],
      }),
      Person,
    );
    deepStrictEqual(documentLoader.fetched, [first, second]);
  });

  await t.step("explicit gateways replace location hints", async () => {
    const documentLoader = createLoader({
      [second]: person(),
      [hint]: person(),
    });
    assertInstanceOf(
      await lookupObject(
        `ap://${did}/actor?@gateway=https%3A%2F%2Fhint.example`,
        {
          ...options,
          documentLoader,
          gateways: ["https://first.example", "https://second.example"],
        },
      ),
      Person,
    );
    deepStrictEqual(documentLoader.fetched, [first, second]);
  });

  await t.step("empty list uses a custom document loader", async () => {
    const hintedId = `ap://${did}/actor?@gateway=https%3A%2F%2Fhint.example`;
    const canonicalHintedId = `${actorId}?@gateway=https%3A%2F%2Fhint.example`;
    const documentLoader = createLoader({
      [canonicalHintedId]: person(),
      [hint]: person(),
    });
    const actor = await lookupObject(hintedId, {
      ...options,
      documentLoader,
      gateways: [],
    });
    deepStrictEqual(documentLoader.fetched, [canonicalHintedId]);
    assertInstanceOf(actor, Person);
  });

  await t.step("invalid gateway throws before fetching", async () => {
    const documentLoader = createLoader({});
    for (const verifyPortableObject of [undefined, createVerifier()]) {
      await rejects(
        () =>
          lookupObject(actorId, {
            documentLoader,
            contextLoader: mockDocumentLoader,
            verifyPortableObject,
            gateways: ["https://bad.example/path"],
          }),
        TypeError,
      );
    }
    deepStrictEqual(documentLoader.fetched, []);
  });

  await t.step("a malformed portable ID is refused first", async () => {
    const documentLoader = createLoader({});
    equal(
      await lookupObject(`ap://${did}/x/../actor`, {
        ...options,
        documentLoader,
        gateways: ["https://bad.example/path"],
      }),
      null,
    );
    deepStrictEqual(documentLoader.fetched, []);
  });
});

test("getActorHandle() with FEP-ef61 portable actors", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const actor = new Person({
    id: parseIri(actorId),
    preferredUsername: "alice",
    gateways: [new URL("https://example.com"), new URL("https://example.org")],
  });
  fetchMock.spyGlobal();
  try {
    await t.step("verified through the first gateway", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "https://example.com/.well-known/webfinger?resource=acct%3Aalice%40example.com",
        selfLinks(compatibleId),
      );
      deepStrictEqual(await getActorHandle(actor), "@alice@example.com");
    });

    await t.step("canonical self link", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, selfLinks(`ap://${did}/actor`));
      deepStrictEqual(await getActorHandle(actor), "@alice@example.com");
    });

    await t.step("follows a verified subject", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, {
        ...selfLinks(compatibleId),
        subject: "acct:alice@example.org",
      });
      fetchMock.get(
        "begin:https://example.org/.well-known/webfinger",
        { ...selfLinks(compatibleId), subject: "acct:alice@example.org" },
      );
      deepStrictEqual(await getActorHandle(actor), "@alice@example.org");

      // An unverified subject is ignored:
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, {
        ...selfLinks(compatibleId),
        subject: "acct:alice@example.org",
      });
      fetchMock.get(
        "begin:https://example.org/.well-known/webfinger",
        selfLinks(`ap://${did}/other`),
      );
      deepStrictEqual(await getActorHandle(actor), "@alice@example.com");
    });

    await t.step("rejects a WebFinger response for another actor", async () => {
      for (
        const jrd of [
          selfLinks(`https://example.com/.well-known/apgateway/${did}/other`),
          selfLinks("https://example.com/users/alice"),
          { subject: "acct:alice@example.com", links: [] },
        ]
      ) {
        fetchMock.removeRoutes();
        fetchMock.get(webFingerPrefix, jrd);
        await rejects(() => getActorHandle(actor), TypeError);
      }
    });

    await t.step("does not fall back when WebFinger fails", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(webFingerPrefix, 404);
      await rejects(() => getActorHandle(actor), TypeError);
    });

    await t.step("not enough information", async () => {
      fetchMock.removeRoutes();
      fetchMock.clearHistory();
      for (
        const target of [
          parseIri(actorId),
          new Person({ id: parseIri(actorId), preferredUsername: "alice" }),
          new Person({
            id: parseIri(actorId),
            gateways: [new URL("https://example.com")],
          }),
        ]
      ) {
        await rejects(() => getActorHandle(target), TypeError);
      }
      deepStrictEqual(fetchMock.callHistory.calls().length, 0);
    });
  } finally {
    fetchMock.removeRoutes();
    fetchMock.hardReset();
  }
});

test("lookupObject() reports inferred gateways as hints", async () => {
  const calls: PortableObjectVerifierOptions[] = [];
  // deno-lint-ignore require-await
  const verifyPortableObject: PortableObjectVerifier = async (_, options) => {
    calls.push(options);
    return { verified: true };
  };
  const actor = await lookupObject(compatibleId, {
    documentLoader: createLoader({ [compatibleId]: person() }),
    contextLoader: mockDocumentLoader,
    verifyPortableObject,
  });
  assertInstanceOf(actor, Person);
  deepStrictEqual(calls.length, 1);
  deepStrictEqual(calls[0].gateways, undefined);
  deepStrictEqual(calls[0].gatewayHints, [new URL("https://example.com")]);
});

test("lookupObject() reports explicit gateways to the verifier", async (t) => {
  const calls: PortableObjectVerifierOptions[] = [];
  // deno-lint-ignore require-await
  const verifyPortableObject: PortableObjectVerifier = async (_, options) => {
    calls.push(options);
    return { verified: true };
  };

  await t.step("bare ID with a limited explicit list", async () => {
    const fifth = `https://g4.example${gatewayPath}`;
    const documentLoader = createLoader({ [fifth]: person() });
    assertInstanceOf(
      await lookupObject(actorId, {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject,
        gateways: Array.from({ length: 6 }, (_, i) => `https://g${i}.example`),
      }),
      Person,
    );
    deepStrictEqual(
      documentLoader.fetched,
      [0, 1, 2, 3, 4].map((i) => `https://g${i}.example${gatewayPath}`),
    );
    deepStrictEqual(
      calls.at(-1)?.gateways,
      [0, 1, 2, 3, 4].map((i) => new URL(`https://g${i}.example`)),
    );
    equal(calls.at(-1)?.gatewayHints, undefined);
  });

  await t.step(
    "compatible origin stays first and is deduplicated",
    async () => {
      const second = `https://second.example${gatewayPath}`;
      const documentLoader = createLoader({ [second]: person() });
      assertInstanceOf(
        await lookupObject(compatibleId, {
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject,
          gateways: ["https://example.com", "https://second.example"],
        }),
        Person,
      );
      deepStrictEqual(documentLoader.fetched, [compatibleId, second]);
      deepStrictEqual(calls.at(-1)?.gateways, [
        new URL("https://example.com"),
        new URL("https://second.example"),
      ]);
      equal(calls.at(-1)?.gatewayHints, undefined);
    },
  );

  await t.step("empty list keeps the compatible origin", async () => {
    const documentLoader = createLoader({ [compatibleId]: person() });
    assertInstanceOf(
      await lookupObject(compatibleId, {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject,
        gateways: [],
      }),
      Person,
    );
    deepStrictEqual(documentLoader.fetched, [compatibleId]);
    deepStrictEqual(calls.at(-1)?.gateways, []);
    equal(calls.at(-1)?.gatewayHints, undefined);
  });
});

test("lookupObject() verifies fetched documents that stand for portable objects", async (t) => {
  const plainUrl = "https://example.com/users/alice";
  const redirectingLoader = (
    documentUrl: string,
    document: Record<string, unknown>,
  ): DocumentLoader & { readonly fetched: string[] } => {
    const fetched: string[] = [];
    // deno-lint-ignore require-await
    const loader = async (url: string): Promise<RemoteDocument> => {
      fetched.push(url);
      if (url !== plainUrl) {
        throw new FetchError(
          url,
          "HTTP 404",
          new globalThis.Response(null, { status: 404 }),
        );
      }
      return { contextUrl: null, documentUrl, document };
    };
    return Object.assign(loader, { fetched });
  };

  await t.step("a redirect to a compatible identifier", async () => {
    const calls: PortableObjectVerifierOptions[] = [];
    const documentLoader = redirectingLoader(compatibleId, person());
    const actor = await lookupObject(plainUrl, {
      documentLoader,
      contextLoader: mockDocumentLoader,
      // deno-lint-ignore require-await
      verifyPortableObject: async (_, options) => {
        calls.push(options);
        return { verified: true };
      },
    });
    assertInstanceOf(actor, Person);
    deepStrictEqual(actor.id, parseIri(actorId));
    // Verified in place, without another request:
    deepStrictEqual(documentLoader.fetched, [plainUrl]);
    deepStrictEqual(calls.length, 1);
    deepStrictEqual(calls[0].documentUrl, new URL(compatibleId));
    deepStrictEqual(calls[0].gatewayHints, [new URL("https://example.com")]);
    const explicitCalls: PortableObjectVerifierOptions[] = [];
    const explicitActor = await lookupObject(plainUrl, {
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways: ["https://other.example"],
      // deno-lint-ignore require-await
      verifyPortableObject: async (_, options) => {
        explicitCalls.push(options);
        return { verified: true };
      },
    });
    assertInstanceOf(explicitActor, Person);
    deepStrictEqual(explicitCalls[0].gateways, [
      new URL("https://other.example"),
    ]);
    equal(explicitCalls[0].gatewayHints, undefined);
    await rejects(
      () =>
        lookupObject(plainUrl, {
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(),
          gateways: ["https://bad.example/path"],
        }),
      TypeError,
    );
    equal(
      await lookupObject(plainUrl, {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
      }),
      null,
    );
    // A document that claims another object:
    equal(
      await lookupObject(plainUrl, {
        documentLoader: redirectingLoader(
          compatibleId,
          person(`ap://${did}/other`),
        ),
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      }),
      null,
    );
  });

  await t.step("a compatible @id", async () => {
    const document = person(compatibleId);
    const documentLoader = redirectingLoader(plainUrl, document);
    // The document stands for the portable object, and is verified as it:
    const verifyPortableObject = createVerifier();
    const verified = await lookupObject(plainUrl, {
      documentLoader,
      contextLoader: mockDocumentLoader,
      verifyPortableObject,
    });
    assertInstanceOf(verified, Person);
    deepStrictEqual(verified.id, new URL(compatibleId));
    deepStrictEqual(verifyPortableObject.documents, [document]);
    equal(
      await lookupObject(plainUrl, {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
      }),
      null,
    );
    // Without verifyPortableObject, it is fetched as before:
    const actor = await lookupObject(plainUrl, {
      documentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertInstanceOf(actor, Person);
    deepStrictEqual(actor.id, new URL(compatibleId));
  });

  await t.step("a portable @id", async () => {
    const documentLoader = redirectingLoader(plainUrl, person());
    const actor = await lookupObject(plainUrl, {
      documentLoader,
      contextLoader: mockDocumentLoader,
      verifyPortableObject: createVerifier(),
    });
    assertInstanceOf(actor, Person);
    deepStrictEqual(actor.id, parseIri(actorId));
    equal(
      await lookupObject(plainUrl, {
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
      }),
      null,
    );
    await rejects(
      () =>
        lookupObject(plainUrl, {
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(false),
          crossOrigin: "throw",
        }),
      /No gateway returned a valid portable object/,
    );
  });
});
