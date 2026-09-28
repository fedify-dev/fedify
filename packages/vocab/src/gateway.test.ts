import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import {
  type DocumentLoader,
  FetchError,
  getDocumentLoader,
  parseIri,
  type PortableObjectVerification,
  type PortableObjectVerifier,
  type PortableObjectVerifierOptions,
  type RemoteDocument,
} from "@fedify/vocab-runtime";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import { traverseCollection } from "./lookup.ts";
import { assertInstanceOf } from "./utils.ts";
import {
  Collection,
  CollectionPage,
  Create,
  Note,
  OrderedCollection,
  Person,
} from "./vocab.ts";

const did = "did:key:z6Mkabc";
const objectId = `ap+ef61://${did}/objects/1`;
const gatewayPath = `/.well-known/apgateway/${did}/objects/1`;

function note(id: string = `ap://${did}/objects/1`): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: "Note",
    content: "Portable note",
  };
}

type Response = Record<string, unknown> | unknown[] | number | Error;

function createLoader(
  responses: Record<string, Response>,
): DocumentLoader & { readonly fetched: string[] } {
  const fetched: string[] = [];
  // deno-lint-ignore require-await
  const loader = async (url: string): Promise<RemoteDocument> => {
    fetched.push(url);
    const response = responses[url];
    if (response == null) {
      throw new FetchError(
        url,
        "HTTP 404",
        new globalThis.Response(null, {
          status: 404,
        }),
      );
    }
    if (response instanceof Error) throw response;
    if (typeof response === "number") {
      throw new FetchError(
        url,
        `HTTP ${response}`,
        new globalThis.Response(null, { status: response }),
      );
    }
    return { contextUrl: null, documentUrl: url, document: response };
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

function createActivity(object: string = objectId): Promise<Create> {
  return Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: `ap://${did}/activities/1`,
    object,
  }, { contextLoader: mockDocumentLoader });
}

test("getObject() dereferences a portable IRI through explicit gateways", async () => {
  const document = note();
  const documentLoader = createLoader({
    [`https://gw1.example${gatewayPath}`]: document,
  });
  const verifyPortableObject = createVerifier();
  const activity = await createActivity();
  const object = await activity.getObject({
    documentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw1.example", new URL("https://gw2.example/")],
    verifyPortableObject,
  });
  assertInstanceOf(object, Note);
  deepStrictEqual(
    object.id,
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/objects/1"),
  );
  deepStrictEqual(object.content, "Portable note");
  deepStrictEqual(documentLoader.fetched, [
    `https://gw1.example${gatewayPath}`,
  ]);
  // The verifier receives the fetched JSON as is:
  deepStrictEqual(verifyPortableObject.documents, [document]);

  // The fetched object is cached like any other dereferenced object:
  deepStrictEqual(
    (await activity.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
    }))?.content,
    "Portable note",
  );
  deepStrictEqual(documentLoader.fetched.length, 1);
});

test("getObject() keeps non-hint query parameters for gateways", async () => {
  const documentLoader = createLoader({
    [`https://gw.example${gatewayPath}?page=2`]: note(
      `ap://${did}/objects/1?page=2`,
    ),
  });
  const activity = await createActivity(
    `${objectId}?page=2&@gateway=https%3A%2F%2Fgw.example`,
  );
  const object = await activity.getObject({
    documentLoader,
    contextLoader: mockDocumentLoader,
    verifyPortableObject: createVerifier(),
  });
  assertInstanceOf(object, Note);
  deepStrictEqual(documentLoader.fetched, [
    `https://gw.example${gatewayPath}?page=2`,
  ]);
});

test("getObject() tries the next gateway after failures", async () => {
  const documentLoader = createLoader({
    [`https://gw2.example${gatewayPath}`]: new TypeError("Network error"),
    [`https://gw3.example${gatewayPath}`]: 500,
    [`https://gw4.example${gatewayPath}`]: note(),
    [`https://gw5.example${gatewayPath}`]: note(),
  });
  const [tracerProvider, exporter] = createTestTracerProvider();
  const activity = await createActivity();
  const object = await activity.getObject({
    documentLoader,
    contextLoader: mockDocumentLoader,
    tracerProvider,
    gateways: [
      "https://gw1.example", // 404 Not Found
      "https://gw2.example", // network error
      "https://gw3.example", // 500 Internal Server Error
      "https://gw4.example",
      "https://gw5.example",
    ],
    verifyPortableObject: createVerifier(),
  });
  assertInstanceOf(object, Note);
  // Stops at the first gateway that serves a valid object:
  deepStrictEqual(documentLoader.fetched, [
    `https://gw1.example${gatewayPath}`,
    `https://gw2.example${gatewayPath}`,
    `https://gw3.example${gatewayPath}`,
    `https://gw4.example${gatewayPath}`,
  ]);
  const spans = exporter.getSpans("activitypub.lookup_object");
  deepStrictEqual(spans.length, 1);
  deepStrictEqual(spans[0].status.code, 0); // UNSET
  deepStrictEqual(
    spans[0].attributes["activitypub.gateway"],
    "https://gw4.example/",
  );
  deepStrictEqual(
    spans[0].attributes["activitypub.object.type"],
    "https://www.w3.org/ns/activitystreams#Note",
  );
});

test("getObject() reports errors when every gateway fails", async () => {
  const single = createLoader({ [`https://gw1.example${gatewayPath}`]: 500 });
  await rejects(
    async () =>
      await (await createActivity()).getObject({
        documentLoader: single,
        contextLoader: mockDocumentLoader,
        gateways: ["https://gw1.example"],
        verifyPortableObject: createVerifier(),
      }),
    FetchError,
  );

  const multiple = createLoader({
    [`https://gw1.example${gatewayPath}`]: 500,
    [`https://gw2.example${gatewayPath}`]: new TypeError("Network error"),
  });
  const options = {
    documentLoader: multiple,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw1.example", "https://gw2.example"],
    verifyPortableObject: createVerifier(),
  };
  await rejects(
    async () => await (await createActivity()).getObject(options),
    (error) => {
      assertInstanceOf(error, AggregateError);
      deepStrictEqual(error.errors.length, 2);
      assertInstanceOf(error.errors[0], FetchError);
      assertInstanceOf(error.errors[1], TypeError);
      return true;
    },
  );

  const [tracerProvider, exporter] = createTestTracerProvider();
  deepStrictEqual(
    await (await createActivity()).getObject({
      ...options,
      suppressError: true,
      tracerProvider,
    }),
    null,
  );
  const spans = exporter.getSpans("activitypub.lookup_object");
  deepStrictEqual(spans.length, 1);
  deepStrictEqual(spans[0].status.code, 2); // ERROR

  // A document that cannot be parsed is an error as well:
  const unparsable = createLoader({
    [`https://gw1.example${gatewayPath}`]: {
      ...note(),
      "@context": "https://example.com/unknown-context",
    },
  });
  await rejects(
    async () =>
      await (await createActivity()).getObject({
        documentLoader: unparsable,
        contextLoader: mockDocumentLoader,
        gateways: ["https://gw1.example"],
        verifyPortableObject: createVerifier(),
      }),
  );
});

test("getObject() rejects objects with a mismatching portable ID", async (t) => {
  const mismatches = {
    "another DID": `ap://did:key:z6Mkdef/objects/1`,
    "another path": `ap://${did}/objects/2`,
    "a dot segment": `ap://${did}/objects/x/../1`,
    "a fragment": `ap://${did}/objects/1#fragment`,
    "a compatible identifier of another DID":
      `https://gw1.example/.well-known/apgateway/did:key:z6Mkdef/objects/1`,
    "a compatible identifier of another path":
      `https://gw1.example/.well-known/apgateway/${did}/objects/2`,
    "an HTTP(S) ID": "https://gw1.example/objects/1",
  };
  for (const [name, id] of globalThis.Object.entries(mismatches)) {
    await t.step(name, async () => {
      const documentLoader = createLoader({
        [`https://gw1.example${gatewayPath}`]: note(id),
      });
      const options = {
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways: ["https://gw1.example"],
        verifyPortableObject: createVerifier(),
      };
      deepStrictEqual(await (await createActivity()).getObject(options), null);
      deepStrictEqual(
        await (await createActivity()).getObject({
          ...options,
          crossOrigin: "trust",
        }),
        null,
      );
      deepStrictEqual(
        await (await createActivity()).getObject({
          ...options,
          crossOrigin: "throw",
          suppressError: true,
        }),
        null,
      );
      await rejects(
        async () =>
          await (await createActivity()).getObject({
            ...options,
            crossOrigin: "throw",
          }),
        /No gateway returned a valid portable object/,
      );
    });
  }

  await t.step("equivalent spellings", async () => {
    for (
      const id of [
        `ap+ef61://${did}/objects/1`,
        `ap://did%3Akey%3Az6Mkabc/objects/1`,
        `ap://${did}/objects/1?@gateway=https%3A%2F%2Fother.example`,
      ]
    ) {
      const documentLoader = createLoader({
        [`https://gw1.example${gatewayPath}`]: note(id),
      });
      const object = await (await createActivity()).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways: ["https://gw1.example"],
        verifyPortableObject: createVerifier(),
      });
      assertInstanceOf(object, Note);
    }
  });

  await t.step("a mismatch does not stop other gateways", async () => {
    const documentLoader = createLoader({
      [`https://gw1.example${gatewayPath}`]: note(`ap://${did}/objects/2`),
      [`https://gw2.example${gatewayPath}`]: 500,
      [`https://gw3.example${gatewayPath}`]: note(),
    });
    const object = await (await createActivity()).getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways: [
        "https://gw1.example",
        "https://gw2.example",
        "https://gw3.example",
      ],
      verifyPortableObject: createVerifier(),
      crossOrigin: "throw",
    });
    assertInstanceOf(object, Note);
  });

  await t.step(
    "a mismatch among errors is reported as a mismatch",
    async () => {
      const documentLoader = createLoader({
        [`https://gw1.example${gatewayPath}`]: 500,
        [`https://gw2.example${gatewayPath}`]: note(`ap://${did}/objects/2`),
      });
      deepStrictEqual(
        await (await createActivity()).getObject({
          documentLoader,
          contextLoader: mockDocumentLoader,
          gateways: ["https://gw1.example", "https://gw2.example"],
          verifyPortableObject: createVerifier(),
        }),
        null,
      );
    },
  );
});

test("getObject() rejects documents with other shapes", async () => {
  for (
    const document of [
      [note()],
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        "@graph": [note(), note(`ap://${did}/objects/2`)],
      },
    ]
  ) {
    const documentLoader = createLoader({
      [`https://gw1.example${gatewayPath}`]: document,
    });
    deepStrictEqual(
      await (await createActivity()).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways: ["https://gw1.example"],
        verifyPortableObject: createVerifier(),
      }),
      null,
    );
  }
});

test("getObject() leaves documents without @id to the verifier", async () => {
  const document = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    content: "No ID",
  };
  const documentLoader = createLoader({
    [`https://gw1.example${gatewayPath}`]: document,
  });
  const options = {
    documentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw1.example"],
  };
  const rejecting = createVerifier(false);
  deepStrictEqual(
    await (await createActivity()).getObject({
      ...options,
      verifyPortableObject: rejecting,
    }),
    null,
  );
  deepStrictEqual(rejecting.documents, [document]);
  const object = await (await createActivity()).getObject({
    ...options,
    verifyPortableObject: createVerifier(),
  });
  assertInstanceOf(object, Note);
  deepStrictEqual(object.id, null);
});

test("getObject() applies the portable object verifier", async () => {
  const gateways = ["https://gw1.example", "https://gw2.example"];
  const documentLoader = createLoader({
    [`https://gw1.example${gatewayPath}`]: note(),
    [`https://gw2.example${gatewayPath}`]: note(),
  });
  const failing = createVerifier(false);
  deepStrictEqual(
    await (await createActivity()).getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways,
      verifyPortableObject: failing,
      crossOrigin: "trust",
    }),
    null,
  );
  deepStrictEqual(failing.documents.length, 2);
  await rejects(
    async () =>
      await (await createActivity()).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways,
        verifyPortableObject: failing,
        crossOrigin: "throw",
      }),
    /No gateway returned a valid portable object/,
  );

  deepStrictEqual(
    await (await createActivity()).getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways,
      // deno-lint-ignore require-await
      verifyPortableObject: async () => {
        throw new Error("Verifier failure");
      },
    }),
    null,
  );

  // A failed dereference is not cached; a later call retries:
  const activity = await createActivity();
  deepStrictEqual(
    await activity.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways,
      verifyPortableObject: failing,
    }),
    null,
  );
  assertInstanceOf(
    await activity.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways,
      verifyPortableObject: createVerifier(),
    }),
    Note,
  );
});

test("getObject() requires a verifier before fetching portable IRIs", async () => {
  const documentLoader = createLoader({
    [`https://gw1.example${gatewayPath}`]: note(),
  });
  await rejects(
    async () =>
      await (await createActivity()).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways: ["https://gw1.example"],
      }),
    (error) => {
      assertInstanceOf(error, TypeError);
      ok(error.message.includes("verifyPortableObject"));
      return true;
    },
  );
  deepStrictEqual(
    await (await createActivity()).getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways: ["https://gw1.example"],
      suppressError: true,
    }),
    null,
  );
  deepStrictEqual(documentLoader.fetched, []);
});

test("getObject() suppresses errors for malformed portable IRIs", async () => {
  const activity = await createActivity(`ap://${did}/objects/%ZZ`);
  for (const gateways of [[], ["https://gw1.example"]]) {
    const documentLoader = createLoader({});
    deepStrictEqual(
      await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways,
        verifyPortableObject: createVerifier(),
        suppressError: true,
      }),
      null,
    );
    deepStrictEqual(documentLoader.fetched, []);
    await rejects(async () =>
      await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways,
        verifyPortableObject: createVerifier(),
      }), TypeError);
  }
});

test("getObject() rejects invalid gateways before fetching", async () => {
  const documentLoader = createLoader({});
  for (
    const gateway of [
      "https://gw.example/path",
      "https://gw.example/?query",
      "https://user@gw.example",
      "ftp://gw.example",
      "not a URL",
    ]
  ) {
    await rejects(
      async () =>
        await (await createActivity()).getObject({
          documentLoader,
          contextLoader: mockDocumentLoader,
          gateways: [gateway],
          verifyPortableObject: createVerifier(),
          suppressError: true,
        }),
      TypeError,
    );
  }
  deepStrictEqual(documentLoader.fetched, []);
});

test("getObject() uses @gateway location hints", async (t) => {
  await t.step("in order, skipping invalid and duplicate hints", async () => {
    const documentLoader = createLoader({
      [`https://gw2.example${gatewayPath}`]: note(),
    });
    const activity = await createActivity(
      `${objectId}?@gateway=https%3A%2F%2Fgw1.example` +
        "&@gateway=https%3A%2F%2Fgw1.example%2F" +
        "&@gateway=https%3A%2F%2Finvalid.example%2Fpath" +
        "&%40gateway=https%3A%2F%2Fgw2.example" +
        "&gateways=https%3A%2F%2Flegacy.example",
    );
    const object = await activity.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      verifyPortableObject: createVerifier(),
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(documentLoader.fetched, [
      `https://gw1.example${gatewayPath}`,
      `https://gw2.example${gatewayPath}`,
    ]);
  });

  await t.step("up to five hints", async () => {
    const documentLoader = createLoader({});
    const hints = [1, 2, 3, 4, 5, 6, 7].map((i) =>
      `@gateway=https%3A%2F%2Fgw${i}.example`
    );
    const activity = await createActivity(`${objectId}?${hints.join("&")}`);
    await rejects(async () =>
      await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      })
    );
    deepStrictEqual(
      documentLoader.fetched,
      [1, 2, 3, 4, 5].map((i) => `https://gw${i}.example${gatewayPath}`),
    );
  });

  await t.step("replaced by explicit gateways", async () => {
    const documentLoader = createLoader({
      [`https://explicit.example${gatewayPath}`]: note(),
    });
    const activity = await createActivity(
      `${objectId}?@gateway=https%3A%2F%2Fhint.example`,
    );
    const object = await activity.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      gateways: ["https://explicit.example"],
      verifyPortableObject: createVerifier(),
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(documentLoader.fetched, [
      `https://explicit.example${gatewayPath}`,
    ]);
  });

  await t.step("disabled by an empty gateway list", async () => {
    const documentLoader = createLoader({});
    const activity = await createActivity(
      `${objectId}?@gateway=https%3A%2F%2Fhint.example`,
    );
    deepStrictEqual(
      await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways: [],
        verifyPortableObject: createVerifier(),
        suppressError: true,
      }),
      null,
    );
    deepStrictEqual(documentLoader.fetched, [
      `ap+ef61://${did}/objects/1?@gateway=https%3A%2F%2Fhint.example`,
    ]);
  });
});

test("getObject() lets the document loader handle portable IRIs without gateways", async () => {
  const documentLoader = createLoader({ [objectId]: note() });
  const activity = await createActivity();
  const object = await activity.getObject({
    documentLoader,
    contextLoader: mockDocumentLoader,
    verifyPortableObject: createVerifier(),
  });
  assertInstanceOf(object, Note);
  deepStrictEqual(documentLoader.fetched, [objectId]);

  // The same validation applies:
  const spoofing = createLoader({ [objectId]: note(`ap://${did}/objects/2`) });
  deepStrictEqual(
    await (await createActivity()).getObject({
      documentLoader: spoofing,
      contextLoader: mockDocumentLoader,
      verifyPortableObject: createVerifier(),
    }),
    null,
  );
  deepStrictEqual(
    await (await createActivity()).getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      verifyPortableObject: createVerifier(false),
    }),
    null,
  );
});

test("getObject() shares context documents within a dereference", async (t) => {
  const contextUrl = "https://example.com/portable-context";
  const document = {
    "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
    id: `ap://${did}/objects/1`,
    type: "Note",
    content: "Portable note",
  };

  await t.step("custom contexts are loaded once", async () => {
    const loaded: string[] = [];
    let version = 0;
    const contextLoader: DocumentLoader = async (url) => {
      loaded.push(url);
      if (url === contextUrl) {
        version++;
        return {
          contextUrl: null,
          documentUrl: url,
          document: { "@context": { version: `urn:version:${version}` } },
        };
      }
      return await mockDocumentLoader(url);
    };
    const contexts: unknown[] = [];
    const verifyPortableObject: PortableObjectVerifier = async (
      _,
      { contextLoader },
    ) => {
      contexts.push((await contextLoader!(contextUrl)).document);
      contexts.push((await contextLoader!(contextUrl)).document);
      return { verified: true };
    };
    const object = await (await createActivity()).getObject({
      documentLoader: createLoader({
        [`https://gw1.example${gatewayPath}`]: document,
      }),
      contextLoader,
      gateways: ["https://gw1.example"],
      verifyPortableObject,
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(loaded.filter((url) => url === contextUrl).length, 1);
    deepStrictEqual(contexts, [
      { "@context": { version: "urn:version:1" } },
      { "@context": { version: "urn:version:1" } },
    ]);
  });

  await t.step("baseline contexts use built-in copies", async () => {
    const loaded: string[] = [];
    const contextLoader: DocumentLoader = async (url) => {
      loaded.push(url);
      return await mockDocumentLoader(url);
    };
    const object = await (await createActivity()).getObject({
      documentLoader: createLoader({
        [`https://gw1.example${gatewayPath}`]: note(),
      }),
      contextLoader,
      gateways: ["https://gw1.example"],
      verifyPortableObject: createVerifier(),
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(loaded, []);
  });

  await t.step("the snapshot ends with the dereference", async () => {
    const loaded: string[] = [];
    const contextLoader: DocumentLoader = async (url) => {
      loaded.push(url);
      if (url === contextUrl) {
        return {
          contextUrl: null,
          documentUrl: url,
          document: { "@context": {} },
        };
      }
      return await mockDocumentLoader(url);
    };
    const object = await (await createActivity()).getObject({
      documentLoader: createLoader({
        [`https://gw1.example${gatewayPath}`]: {
          ...document,
          attributedTo: "https://example.com/person",
        },
      }),
      contextLoader,
      gateways: ["https://gw1.example"],
      verifyPortableObject: createVerifier(),
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(loaded, [contextUrl]);
    // Later dereferences on the returned object do not reuse the snapshot,
    // so they load the custom context through the caller's loader again:
    const person = await object.getAttribution({
      documentLoader: createLoader({
        "https://example.com/person": {
          "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
          id: "https://example.com/person",
          type: "Person",
        },
      }),
    });
    deepStrictEqual(person?.id, new URL("https://example.com/person"));
    deepStrictEqual(loaded, [contextUrl, contextUrl]);
  });

  await t.step("failed context loads are retried", async () => {
    let failures = 1;
    const contextLoader: DocumentLoader = async (url) => {
      if (url === contextUrl && failures-- > 0) {
        throw new TypeError("Temporary failure");
      }
      if (url === contextUrl) {
        return {
          contextUrl: null,
          documentUrl: url,
          document: { "@context": {} },
        };
      }
      return await mockDocumentLoader(url);
    };
    const object = await (await createActivity()).getObject({
      documentLoader: createLoader({
        [`https://gw1.example${gatewayPath}`]: document,
        [`https://gw2.example${gatewayPath}`]: document,
      }),
      contextLoader,
      gateways: ["https://gw1.example", "https://gw2.example"],
      verifyPortableObject: createVerifier(),
    });
    assertInstanceOf(object, Note);
  });
});

test("getObjects() dereferences each portable IRI separately", async () => {
  const activity = await Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: `ap://${did}/activities/1`,
    object: [objectId, `ap://${did}/objects/2`],
  }, { contextLoader: mockDocumentLoader });
  const documentLoader = createLoader({
    [`https://gw.example${gatewayPath}`]: note(),
    [`https://gw.example/.well-known/apgateway/${did}/objects/2`]: note(),
  });
  const objects = await Array.fromAsync(activity.getObjects({
    documentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw.example"],
    verifyPortableObject: createVerifier(),
  }));
  // The second one is rejected because its @id does not match:
  deepStrictEqual(objects.length, 1);
  deepStrictEqual(
    objects[0].id?.href,
    "ap+ef61://did%3Akey%3Az6Mkabc/objects/1",
  );
});

test("getObject() ignores gateway options for HTTP(S) IRIs", async () => {
  const activity = new Create({
    object: new URL("https://example.com/object"),
  });
  const object = await activity.getObject({
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw.example"],
  });
  deepStrictEqual(object?.id, new URL("https://example.com/object"));
});

test("getObject() sends the ActivityStreams Accept header to gateways", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  fetchMock.spyGlobal();
  let accept: string | null = null;
  fetchMock.get(`https://example.com${gatewayPath}`, (callLog) => {
    accept = callLog.request?.headers.get("Accept") ??
      new Headers(callLog.options.headers).get("Accept");
    return {
      headers: {
        "Content-Type":
          'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      },
      body: note(),
    };
  });
  try {
    const object = await (await createActivity()).getObject({
      documentLoader: getDocumentLoader(),
      contextLoader: mockDocumentLoader,
      gateways: ["https://example.com"],
      verifyPortableObject: createVerifier(),
    });
    assertInstanceOf(object, Note);
    ok(
      accept != null &&
        (accept as string).includes(
          'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        ),
      `Unexpected Accept header: ${accept}`,
    );
  } finally {
    fetchMock.hardReset();
  }
});

const AS = "https://www.w3.org/ns/activitystreams#";

function gatewayUrl(gateway: string, path: string): string {
  return `${gateway}/.well-known/apgateway/${did}${path}`;
}

function createRecordingVerifier(
  decide: (
    document: unknown,
    options: PortableObjectVerifierOptions,
  ) => PortableObjectVerification = () => ({ verified: true }),
): PortableObjectVerifier & {
  readonly calls: {
    document: unknown;
    options: PortableObjectVerifierOptions;
  }[];
} {
  const calls: {
    document: unknown;
    options: PortableObjectVerifierOptions;
  }[] = [];
  // deno-lint-ignore require-await
  const verifier = async (
    document: unknown,
    options: PortableObjectVerifierOptions,
  ) => {
    calls.push({ document, options });
    return decide(document, options);
  };
  return Object.assign(verifier, { calls });
}

function portableCollection(
  path: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `ap://${did}${path}`,
    type: "OrderedCollection",
    totalItems: 0,
    ...extra,
  };
}

test("getOutbox() passes the fetch source and referrer to the verifier", async () => {
  const person = await Person.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `ap://${did}/actor`,
    type: "Person",
    inbox: `ap://${did}/actor/inbox`,
    outbox: `ap://${did}/actor/outbox?@gateway=${
      encodeURIComponent("https://hint.example")
    }`,
  }, { contextLoader: mockDocumentLoader });
  const documentLoader = createLoader({
    [gatewayUrl("https://hint.example", "/actor/outbox")]: portableCollection(
      "/actor/outbox",
    ),
  });
  const verifier = createRecordingVerifier();
  const outbox = await person.getOutbox({
    documentLoader,
    contextLoader: mockDocumentLoader,
    verifyPortableObject: verifier,
  });
  assertInstanceOf(outbox, Collection);
  deepStrictEqual(verifier.calls.length, 1);
  const { options } = verifier.calls[0];
  deepStrictEqual(
    options.documentUrl,
    new URL(gatewayUrl("https://hint.example", "/actor/outbox")),
  );
  deepStrictEqual(options.gateways, undefined);
  deepStrictEqual(options.gatewayHints, [new URL("https://hint.example")]);
  ok(options.referrer?.object === person);
  deepStrictEqual(options.referrer?.property, `${AS}outbox`);
  deepStrictEqual(options.referrer?.acceptance, undefined);

  // Explicit gateways are passed as such:
  const person2 = await Person.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `ap://${did}/actor`,
    type: "Person",
    inbox: `ap://${did}/actor/inbox`,
    outbox: `ap://${did}/actor/outbox`,
  }, { contextLoader: mockDocumentLoader });
  const verifier2 = createRecordingVerifier();
  await person2.getOutbox({
    documentLoader: createLoader({
      [gatewayUrl("https://gw.example", "/actor/outbox")]: portableCollection(
        "/actor/outbox",
      ),
    }),
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw.example"],
    verifyPortableObject: verifier2,
  });
  deepStrictEqual(verifier2.calls[0].options.gateways, [
    new URL("https://gw.example"),
  ]);
  deepStrictEqual(verifier2.calls[0].options.gatewayHints, undefined);
});

test("getFirst() passes the referrer chain and collection context", async () => {
  const context = Object.freeze({});
  const documentLoader = createLoader({
    [gatewayUrl("https://gw.example", "/actor")]: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `ap://${did}/actor`,
      type: "Person",
      inbox: `ap://${did}/actor/inbox`,
      outbox: `ap://${did}/actor/outbox`,
    },
    [gatewayUrl("https://gw.example", "/actor/outbox")]: portableCollection(
      "/actor/outbox",
      {
        first: {
          id: `ap://${did}/actor/outbox?page=1`,
          type: "OrderedCollectionPage",
          next: `ap://${did}/actor/outbox?page=2`,
        },
      },
    ),
    [gatewayUrl("https://gw.example", "/actor/outbox?page=2")]: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `ap://${did}/actor/outbox?page=2`,
      type: "OrderedCollectionPage",
      orderedItems: [],
    },
  });
  // The collection is signed in this scenario (verified without the
  // unsecured flag), so its embedded first page is trusted by origin:
  const verifier = createRecordingVerifier((document) =>
    (document as Record<string, unknown>).type === "OrderedCollection"
      ? { verified: true, collectionContext: context }
      : { verified: true }
  );
  const options = {
    documentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw.example"],
    verifyPortableObject: verifier,
  };
  const create = await createActivity(`ap://${did}/actor`);
  const actor = await create.getObject(options);
  assertInstanceOf(actor, Person);
  const outbox = await actor.getOutbox(options);
  assertInstanceOf(outbox, Collection);
  const first = await outbox.getFirst(options);
  assertInstanceOf(first, CollectionPage);
  const next = await first.getNext(options);
  assertInstanceOf(next, CollectionPage);
  const { referrer } = verifier.calls[verifier.calls.length - 1].options;
  // next ← (embedded) first ← outbox ← actor ← create:
  ok(referrer?.object === first);
  deepStrictEqual(referrer?.property, `${AS}next`);
  deepStrictEqual(referrer?.acceptance, undefined);
  ok(referrer?.referrer?.object === outbox);
  deepStrictEqual(referrer?.referrer?.property, `${AS}first`);
  deepStrictEqual(referrer?.referrer?.acceptance, "verified");
  ok(referrer?.referrer?.collectionContext === context);
  ok(referrer?.referrer?.referrer?.object === actor);
  deepStrictEqual(referrer?.referrer?.referrer?.property, `${AS}outbox`);
  deepStrictEqual(referrer?.referrer?.referrer?.acceptance, "verified");
  ok(referrer?.referrer?.referrer?.referrer?.object === create);
});

test("accessors do not trust objects embedded in unsecured collections", async () => {
  const itemPath = "/objects/1";
  const documentLoader = createLoader({
    [gatewayUrl("https://gw.example", "/actor/outbox")]: portableCollection(
      "/actor/outbox",
      {
        orderedItems: [
          // A forged copy of a portable object:
          { id: `ap://${did}${itemPath}`, type: "Note", content: "Forged" },
          // An object that cannot be verified on its own:
          { type: "Note", content: "Anonymous" },
        ],
      },
    ),
    [gatewayUrl("https://gw.example", itemPath)]: note(),
  });
  const verifier = createRecordingVerifier((document) =>
    (document as Record<string, unknown>).type === "OrderedCollection"
      ? { verified: true, unsecured: true }
      : { verified: true }
  );
  const options = {
    documentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw.example"],
    verifyPortableObject: verifier,
  };
  const createPerson = () =>
    Person.fromJsonLd({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `ap://${did}/actor`,
      type: "Person",
      inbox: `ap://${did}/actor/inbox`,
      outbox: `ap://${did}/actor/outbox`,
    }, { contextLoader: mockDocumentLoader });
  const outbox = await (await createPerson()).getOutbox(options);
  assertInstanceOf(outbox, Collection);
  const items = await Array.fromAsync(outbox.getItems(options));
  deepStrictEqual(
    items.map((item) => item instanceof Note ? item.content : null),
    ["Portable note"],
  );
  // Even crossOrigin: "trust" does not make them trusted:
  const outbox2 = await (await createPerson()).getOutbox(options);
  assertInstanceOf(outbox2, Collection);
  const items2 = await Array.fromAsync(
    outbox2.getItems({ ...options, crossOrigin: "trust" }),
  );
  deepStrictEqual(items2.length, 1);

  // A clone keeps the restriction, so its embedded objects are fetched
  // again (and fail here, since nothing can be fetched):
  const outbox3 = await (await createPerson()).getOutbox(options);
  assertInstanceOf(outbox3, Collection);
  const items3 = await Array.fromAsync(
    outbox3.clone().getItems({
      ...options,
      documentLoader: createLoader({}),
      suppressError: true,
    }),
  );
  deepStrictEqual(items3, []);
});

function createRedirectingLoader(
  responses: Record<string, { documentUrl: string; document: unknown }>,
): DocumentLoader & { readonly fetched: string[] } {
  const fetched: string[] = [];
  // deno-lint-ignore require-await
  const loader = async (url: string): Promise<RemoteDocument> => {
    fetched.push(url);
    const response = responses[url];
    if (response == null) {
      throw new FetchError(
        url,
        "HTTP 404",
        new globalThis.Response(null, { status: 404 }),
      );
    }
    return { contextUrl: null, ...response };
  };
  return Object.assign(loader, { fetched });
}

function createHttpActivity(object: unknown): Promise<Create> {
  return Create.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Create",
    id: "https://example.com/activities/1",
    object,
  }, { contextLoader: mockDocumentLoader });
}

const compatibleNoteId = gatewayUrl("https://gw.example", "/objects/1");

test("accessors dereference compatible identifiers through their gateways", async (t) => {
  await t.step("through the named gateway", async () => {
    const documentLoader = createLoader({ [compatibleNoteId]: note() });
    const verifier = createRecordingVerifier();
    const activity = await createHttpActivity(compatibleNoteId);
    const object = await activity.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      verifyPortableObject: verifier,
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(object.id, parseIri(objectId));
    deepStrictEqual(documentLoader.fetched, [compatibleNoteId]);
    deepStrictEqual(verifier.calls.length, 1);
    const { options } = verifier.calls[0];
    deepStrictEqual(options.documentUrl, new URL(compatibleNoteId));
    deepStrictEqual(options.gateways, undefined);
    deepStrictEqual(options.gatewayHints, [new URL("https://gw.example")]);
    ok(options.referrer?.object === activity);
    // The verified object is cached:
    ok(
      await activity.getObject({ documentLoader: createLoader({}) }) === object,
    );
  });

  await t.step("then through explicit gateways", async () => {
    const documentLoader = createLoader({
      [gatewayUrl("https://gw2.example", "/objects/1")]: note(),
    });
    const verifier = createRecordingVerifier();
    const object = await (await createHttpActivity(compatibleNoteId))
      .getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        gateways: ["https://gw2.example", "https://gw.example"],
        verifyPortableObject: verifier,
      });
    assertInstanceOf(object, Note);
    deepStrictEqual(documentLoader.fetched, [
      compatibleNoteId,
      gatewayUrl("https://gw2.example", "/objects/1"),
    ]);
    deepStrictEqual(verifier.calls[0].options.gateways, [
      new URL("https://gw2.example"),
      new URL("https://gw.example"),
    ]);
    deepStrictEqual(verifier.calls[0].options.gatewayHints, undefined);

    // An empty list still asks the gateway that the identifier names:
    const documentLoader2 = createLoader({ [compatibleNoteId]: note() });
    const object2 = await (await createHttpActivity(compatibleNoteId))
      .getObject({
        documentLoader: documentLoader2,
        contextLoader: mockDocumentLoader,
        gateways: [],
        verifyPortableObject: createVerifier(),
      });
    assertInstanceOf(object2, Note);
    deepStrictEqual(documentLoader2.fetched, [compatibleNoteId]);
  });

  await t.step("in plural accessors", async () => {
    const documentLoader = createLoader({ [compatibleNoteId]: note() });
    const objects = await Array.fromAsync(
      (await createHttpActivity([compatibleNoteId])).getObjects({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      }),
    );
    deepStrictEqual(objects.map((o) => o.id), [parseIri(objectId)]);
    deepStrictEqual(documentLoader.fetched, [compatibleNoteId]);
  });
});

test("accessors reject forged objects at compatible identifiers", async () => {
  const forgedId = gatewayUrl("https://evil.example", "/objects/1");
  // The unsigned object from the issue, identified by the compatible
  // identifier itself:
  const forged = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: forgedId,
    type: "Note",
    attributedTo: gatewayUrl("https://evil.example", "/actor"),
    content: "Forged",
  };
  for (const crossOrigin of [undefined, "ignore", "trust"] as const) {
    // Its @id, the compatible identifier itself, stands for the requested
    // portable object, so the proof policy decides, which rejects it for
    // lacking a proof:
    const verifier = createRecordingVerifier(() => ({ verified: false }));
    deepStrictEqual(
      await (await createHttpActivity(forgedId)).getObject({
        documentLoader: createLoader({ [forgedId]: forged }),
        contextLoader: mockDocumentLoader,
        verifyPortableObject: verifier,
        crossOrigin,
      }),
      null,
    );
    deepStrictEqual(verifier.calls.map((c) => c.document), [forged]);
    // With a portable ID, it fails the proof policy:
    deepStrictEqual(
      await (await createHttpActivity(forgedId)).getObject({
        documentLoader: createLoader({ [forgedId]: note() }),
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
        crossOrigin,
      }),
      null,
    );
  }
  await rejects(
    async () =>
      await (await createHttpActivity(forgedId)).getObject({
        documentLoader: createLoader({ [forgedId]: note() }),
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
        crossOrigin: "throw",
      }),
    /No gateway returned a valid portable object/,
  );
});

test("accessors reject malformed compatible identifiers", async () => {
  const malformed = [
    // Location hints are not allowed in compatible identifiers:
    `${compatibleNoteId}?@gateway=https%3A%2F%2Fgw2.example`,
    // Nor are credentials:
    compatibleNoteId.replace("https://", "https://user:pass@"),
  ];
  for (const url of malformed) {
    const documentLoader = createLoader({ [url]: note() });
    const verifier = createRecordingVerifier();
    const activity = await createHttpActivity(url);
    deepStrictEqual(
      await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: verifier,
      }),
      null,
    );
    deepStrictEqual(
      await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: verifier,
        crossOrigin: "throw",
        suppressError: true,
      }),
      null,
    );
    await rejects(
      async () =>
        await activity.getObject({
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: verifier,
          crossOrigin: "throw",
        }),
      /malformed FEP-ef61 compatible identifier/,
    );
    deepStrictEqual(documentLoader.fetched, []);
    deepStrictEqual(verifier.calls, []);
  }
});

test("accessors keep fetching compatible identifiers as HTTP(S) URLs without verifyPortableObject", async (t) => {
  const document = { ...note(), id: compatibleNoteId };

  await t.step("singular accessors", async () => {
    const documentLoader = createLoader({ [compatibleNoteId]: document });
    const activity = await createHttpActivity(compatibleNoteId);
    const object = await activity.getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(object.id, new URL(compatibleNoteId));
    // It is not cached, so the portable object policy applies later:
    deepStrictEqual(
      await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
      }),
      null,
    );
    deepStrictEqual(documentLoader.fetched, [
      compatibleNoteId,
      compatibleNoteId,
    ]);
  });

  await t.step("plural accessors", async () => {
    const documentLoader = createLoader({ [compatibleNoteId]: document });
    const activity = await createHttpActivity([compatibleNoteId]);
    const objects = await Array.fromAsync(activity.getObjects({
      documentLoader,
      contextLoader: mockDocumentLoader,
    }));
    deepStrictEqual(objects.map((o) => o.id), [new URL(compatibleNoteId)]);
    deepStrictEqual(
      await Array.fromAsync(activity.getObjects({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
      })),
      [],
    );
  });

  await t.step("redirects to ordinary objects", async () => {
    const plainUrl = "https://gw.example/notes/1";
    const documentLoader = createRedirectingLoader({
      [compatibleNoteId]: {
        documentUrl: plainUrl,
        document: { ...note(), id: plainUrl },
      },
    });
    for (const activity of [await createHttpActivity(compatibleNoteId)]) {
      const object = await activity.getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
      });
      deepStrictEqual(object?.id, new URL(plainUrl));
      deepStrictEqual(
        await activity.getObject({
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(),
        }),
        null,
      );
    }
    const activity = await createHttpActivity([compatibleNoteId]);
    deepStrictEqual(
      (await Array.fromAsync(activity.getObjects({
        documentLoader,
        contextLoader: mockDocumentLoader,
      }))).length,
      1,
    );
    deepStrictEqual(
      await Array.fromAsync(activity.getObjects({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      })),
      [],
    );
  });

  await t.step("embedded objects", async () => {
    const activity = await createHttpActivity({
      type: "Note",
      id: gatewayUrl("https://example.com", "/objects/1"),
      content: "Embedded",
    });
    const object = await activity.getObject({
      documentLoader: createLoader({}),
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(
      object?.id,
      new URL(gatewayUrl("https://example.com", "/objects/1")),
    );
  });
});

test("accessors dereference compatible identifiers from portable objects", async () => {
  const compatibleOutbox = gatewayUrl("https://gw.example", "/actor/outbox");
  const person = (outbox: unknown) =>
    Person.fromJsonLd({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `ap://${did}/actor`,
      type: "Person",
      inbox: `ap://${did}/actor/inbox`,
      outbox,
    }, { contextLoader: mockDocumentLoader });
  const documentLoader = createRedirectingLoader({
    [compatibleOutbox]: {
      documentUrl: compatibleOutbox,
      document: portableCollection("/actor/outbox"),
    },
    "https://example.com/outbox": {
      documentUrl: compatibleOutbox,
      document: portableCollection("/actor/outbox"),
    },
  });
  for (const crossOrigin of [undefined, "trust"] as const) {
    for (
      const outbox of [
        // A compatible identifier as the reference:
        compatibleOutbox,
        // A redirect to a compatible identifier:
        "https://example.com/outbox",
        // An embedded object with a compatible identifier:
        { ...portableCollection("/actor/outbox"), id: compatibleOutbox },
      ]
    ) {
      const verifier = createRecordingVerifier();
      const collection = await (await person(outbox)).getOutbox({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: verifier,
        crossOrigin,
      });
      assertInstanceOf(collection, OrderedCollection);
      deepStrictEqual(collection.id, parseIri(`ap://${did}/actor/outbox`));
      deepStrictEqual(verifier.calls.length, 1);
      deepStrictEqual(
        verifier.calls[0].options.documentUrl,
        new URL(compatibleOutbox),
      );
      deepStrictEqual(verifier.calls[0].options.gatewayHints, [
        new URL("https://gw.example"),
      ]);
    }
  }
  // Without verifyPortableObject, they are handled like portable IRIs:
  await rejects(
    async () =>
      await (await person(compatibleOutbox)).getOutbox({
        documentLoader,
        contextLoader: mockDocumentLoader,
      }),
    TypeError,
  );
  deepStrictEqual(
    await (await person(compatibleOutbox)).getOutbox({
      documentLoader,
      contextLoader: mockDocumentLoader,
      suppressError: true,
    }),
    null,
  );
});

test("accessors verify fetched documents that stand for portable objects", async (t) => {
  const plainUrl = "https://example.com/notes/1";

  await t.step("a redirect to a compatible identifier", async () => {
    const documentLoader = createRedirectingLoader({
      [plainUrl]: { documentUrl: compatibleNoteId, document: note() },
    });
    const verifier = createRecordingVerifier();
    const object = await (await createHttpActivity(plainUrl)).getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      verifyPortableObject: verifier,
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(object.id, parseIri(objectId));
    // Verified in place, without another request:
    deepStrictEqual(documentLoader.fetched, [plainUrl]);
    deepStrictEqual(verifier.calls.length, 1);
    deepStrictEqual(
      verifier.calls[0].options.documentUrl,
      new URL(compatibleNoteId),
    );
    deepStrictEqual(verifier.calls[0].options.gatewayHints, [
      new URL("https://gw.example"),
    ]);
    // It is rejected if the verifier rejects it:
    deepStrictEqual(
      await (await createHttpActivity(plainUrl)).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
      }),
      null,
    );
    await rejects(
      async () =>
        await (await createHttpActivity(plainUrl)).getObject({
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(false),
          crossOrigin: "throw",
        }),
      /No gateway returned a valid portable object/,
    );
  });

  await t.step("a document that claims another object", async () => {
    for (
      const id of [
        `ap://${did}/objects/2`,
        gatewayUrl("https://gw.example", "/objects/2"),
        "https://gw.example/notes/1",
      ]
    ) {
      const verifier = createRecordingVerifier();
      deepStrictEqual(
        await (await createHttpActivity(plainUrl)).getObject({
          documentLoader: createRedirectingLoader({
            [plainUrl]: { documentUrl: compatibleNoteId, document: note(id) },
          }),
          contextLoader: mockDocumentLoader,
          verifyPortableObject: verifier,
        }),
        null,
      );
      deepStrictEqual(verifier.calls, []);
    }
  });

  await t.step("a portable @id", async () => {
    const verifier = createRecordingVerifier();
    const object = await (await createHttpActivity(plainUrl)).getObject({
      documentLoader: createLoader({ [plainUrl]: note() }),
      contextLoader: mockDocumentLoader,
      verifyPortableObject: verifier,
      // Does not skip the portable object policy:
      crossOrigin: "trust",
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(verifier.calls.length, 1);
    deepStrictEqual(verifier.calls[0].options.documentUrl, new URL(plainUrl));
    deepStrictEqual(
      await (await createHttpActivity(plainUrl)).getObject({
        documentLoader: createLoader({ [plainUrl]: note() }),
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
        crossOrigin: "trust",
      }),
      null,
    );
  });

  await t.step("a compatible @id", async () => {
    // The compatible identifier stands for the portable object, so the
    // document is verified as that object, keeping its own @id:
    const verifier = createRecordingVerifier();
    const url = "https://gw.example/notes/1";
    const documentLoader = createLoader({ [url]: note(compatibleNoteId) });
    const object = await (await createHttpActivity(url)).getObject({
      documentLoader,
      contextLoader: mockDocumentLoader,
      verifyPortableObject: verifier,
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(object.id, new URL(compatibleNoteId));
    deepStrictEqual(verifier.calls.length, 1);
    deepStrictEqual(
      await (await createHttpActivity(url)).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(false),
      }),
      null,
    );
  });

  await t.step("a portable final URL", async () => {
    for (
      const [id, expected] of [
        [objectId, true],
        [`ap://${did}/objects/2`, false],
      ] as const
    ) {
      const object = await (await createHttpActivity(plainUrl)).getObject({
        documentLoader: createRedirectingLoader({
          [plainUrl]: {
            documentUrl: `ap://${did}/objects/1`,
            document: note(id),
          },
        }),
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      });
      deepStrictEqual(object instanceof Note, expected);
    }
    // A final URL that URL parsing would turn into another ID is refused:
    deepStrictEqual(
      await (await createHttpActivity(plainUrl)).getObject({
        documentLoader: createRedirectingLoader({
          [plainUrl]: {
            documentUrl: `ap://${did}/objects/x/../1`,
            document: note(),
          },
        }),
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      }),
      null,
    );
  });

  await t.step("a malformed compatible final URL", async () => {
    const malformed = `${compatibleNoteId}?@gateway=https%3A%2F%2Fgw2.example`;
    const documentLoader = createRedirectingLoader({
      [plainUrl]: { documentUrl: malformed, document: note() },
    });
    deepStrictEqual(
      await (await createHttpActivity(plainUrl)).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: createVerifier(),
      }),
      null,
    );
    await rejects(
      async () =>
        await (await createHttpActivity(plainUrl)).getObject({
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: createVerifier(),
          crossOrigin: "throw",
        }),
      /malformed FEP-ef61 compatible identifier/,
    );
  });

  await t.step("context documents are shared", async () => {
    const contextUrl = "https://example.com/portable-context";
    let version = 0;
    const contextLoader: DocumentLoader = async (url) => {
      if (url === contextUrl) {
        version++;
        return {
          contextUrl: null,
          documentUrl: url,
          document: { "@context": { version: `urn:version:${version}` } },
        };
      }
      return await mockDocumentLoader(url);
    };
    const contexts: unknown[] = [];
    const object = await (await createHttpActivity(plainUrl)).getObject({
      documentLoader: createRedirectingLoader({
        [plainUrl]: {
          documentUrl: compatibleNoteId,
          document: {
            ...note(),
            "@context": ["https://www.w3.org/ns/activitystreams", contextUrl],
          },
        },
      }),
      contextLoader,
      verifyPortableObject: async (_, { contextLoader }) => {
        contexts.push((await contextLoader!(contextUrl)).document);
        return { verified: true };
      },
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(version, 1);
    deepStrictEqual(contexts, [{ "@context": { version: "urn:version:1" } }]);
  });

  await t.step("without verifyPortableObject", async () => {
    // Fetched as before, i.e., refused as a cross-origin object:
    deepStrictEqual(
      await (await createHttpActivity(plainUrl)).getObject({
        documentLoader: createLoader({ [plainUrl]: note() }),
        contextLoader: mockDocumentLoader,
      }),
      null,
    );
    // A redirect to a compatible identifier of the same origin:
    const object = await (await createHttpActivity(plainUrl)).getObject({
      documentLoader: createRedirectingLoader({
        [plainUrl]: {
          documentUrl: gatewayUrl("https://example.com", "/objects/1"),
          document: note(gatewayUrl("https://example.com", "/objects/1")),
        },
      }),
      contextLoader: mockDocumentLoader,
    });
    assertInstanceOf(object, Note);
  });
});

test("accessors verify embedded objects that stand for portable objects", async () => {
  const forgedId = gatewayUrl("https://example.com", "/objects/1");
  const forged = { type: "Note", id: forgedId, content: "Forged" };
  for (const crossOrigin of [undefined, "trust"] as const) {
    // A compatible identifier of the parent's origin:
    const documentLoader = createLoader({ [forgedId]: note() });
    const verifier = createRecordingVerifier(() => ({ verified: false }));
    deepStrictEqual(
      await (await createHttpActivity(forged)).getObject({
        documentLoader,
        contextLoader: mockDocumentLoader,
        verifyPortableObject: verifier,
        crossOrigin,
      }),
      null,
    );
    deepStrictEqual(documentLoader.fetched, [forgedId]);
    deepStrictEqual(verifier.calls.length, 1);
    deepStrictEqual(
      await Array.fromAsync(
        (await createHttpActivity([forged])).getObjects({
          documentLoader,
          contextLoader: mockDocumentLoader,
          verifyPortableObject: verifier,
          crossOrigin,
        }),
      ),
      [],
    );

    // A portable IRI embedded in a non-portable object:
    const documentLoader2 = createLoader({
      [gatewayUrl("https://gw.example", "/objects/1")]: note(),
    });
    const verifier2 = createRecordingVerifier();
    const object = await (await createHttpActivity({
      type: "Note",
      id: objectId,
      content: "Forged",
    })).getObject({
      documentLoader: documentLoader2,
      contextLoader: mockDocumentLoader,
      gateways: ["https://gw.example"],
      verifyPortableObject: verifier2,
      crossOrigin,
    });
    assertInstanceOf(object, Note);
    deepStrictEqual(object.content, "Portable note");
    deepStrictEqual(verifier2.calls.length, 1);
  }

  // A portable object with another DID embedded in a portable object:
  const otherDid = "did:key:z6Mkother";
  const otherId = `ap://${otherDid}/objects/1`;
  const documentLoader = createLoader({
    [`https://gw.example/.well-known/apgateway/${otherDid}/objects/1`]: note(
      otherId,
    ),
  });
  const verifier = createRecordingVerifier();
  const crossDid = await (await createActivity({
    type: "Note",
    id: otherId,
    content: "Forged",
  } as unknown as string)).getObject({
    documentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw.example"],
    verifyPortableObject: verifier,
    crossOrigin: "trust",
  });
  assertInstanceOf(crossDid, Note);
  deepStrictEqual(crossDid.content, "Portable note");
  deepStrictEqual(verifier.calls.length, 1);

  // A portable object embedded in a portable object with the same DID is
  // still trusted as embedded:
  const activity = await createActivity({
    type: "Note",
    id: objectId,
    content: "Embedded",
  } as unknown as string);
  const object = await activity.getObject({
    documentLoader: createLoader({}),
    contextLoader: mockDocumentLoader,
    verifyPortableObject: createVerifier(false),
  });
  assertInstanceOf(object, Note);
  deepStrictEqual(object.content, "Embedded");
});

test("singular accessors drop anonymous objects embedded in unsecured collections", async () => {
  const documentLoader = createLoader({
    [gatewayUrl("https://gw.example", "/actor/outbox")]: portableCollection(
      "/actor/outbox",
      {
        // An anonymous page cannot be fetched and verified on its own:
        first: {
          type: "OrderedCollectionPage",
          orderedItems: [{ type: "Note", content: "Anonymous" }],
        },
      },
    ),
  });
  const options = {
    documentLoader,
    contextLoader: mockDocumentLoader,
    gateways: ["https://gw.example"],
    verifyPortableObject: createRecordingVerifier(() => ({
      verified: true,
      unsecured: true,
    })),
  };
  const person = await Person.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `ap://${did}/actor`,
    type: "Person",
    inbox: `ap://${did}/actor/inbox`,
    outbox: `ap://${did}/actor/outbox`,
  }, { contextLoader: mockDocumentLoader });
  const outbox = await person.getOutbox(options);
  assertInstanceOf(outbox, OrderedCollection);
  deepStrictEqual(await outbox.getFirst(options), null);
  deepStrictEqual(
    await Array.fromAsync(traverseCollection(outbox, options)),
    [],
  );
});
