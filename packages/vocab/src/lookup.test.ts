import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import fetchMock from "fetch-mock";
import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { lookupObject, traverseCollection } from "./lookup.ts";
import { assertInstanceOf } from "./utils.ts";
import { Collection, Note, Object, Person } from "./vocab.ts";

test("lookupObject()", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  fetchMock.spyGlobal();

  fetchMock.get(
    "begin:https://example.com/.well-known/webfinger",
    {
      subject: "acct:johndoe@example.com",
      links: [
        {
          rel: "alternate",
          href: "https://example.com/object",
          type: "application/activity+json",
        },
        {
          rel: "self",
          href: "https://example.com/html/person",
          type: "text/html",
        },
        {
          rel: "self",
          href: "https://example.com/person",
          type: "application/activity+json",
        },
      ],
    },
  );

  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };

  await t.step("actor", async () => {
    const person = await lookupObject("@johndoe@example.com", options);
    assertInstanceOf(person, Person);
    deepStrictEqual(person.id, new URL("https://example.com/person"));
    equal(person.name, "John Doe");
    const person2 = await lookupObject("johndoe@example.com", options);
    deepStrictEqual(person2, person);
    const person3 = await lookupObject("acct:johndoe@example.com", options);
    deepStrictEqual(person3, person);
  });

  await t.step("object", async () => {
    const object = await lookupObject("https://example.com/object", options);
    assertInstanceOf(object, Object);
    deepStrictEqual(
      object,
      new Object({
        id: new URL("https://example.com/object"),
        name: "Fetched object",
      }),
    );
    const person = await lookupObject(
      "https://example.com/hong-gildong",
      options,
    );
    assertInstanceOf(person, Person);
    deepStrictEqual(
      person,
      new Person({
        id: new URL("https://example.com/hong-gildong"),
        name: "Hong Gildong",
      }),
    );
  });

  fetchMock.removeRoutes();
  fetchMock.get("begin:https://example.com/.well-known/webfinger", {
    subject: "acct:janedoe@example.com",
    links: [
      {
        rel: "self",
        href: "https://example.com/404",
        type: "application/activity+json",
      },
    ],
  });

  await t.step("not found", async () => {
    deepStrictEqual(await lookupObject("janedoe@example.com", options), null);
    deepStrictEqual(
      await lookupObject("https://example.com/404", options),
      null,
    );
  });

  fetchMock.removeRoutes();
  fetchMock.get(
    "begin:https://example.com/.well-known/webfinger",
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            subject: "acct:johndoe@example.com",
            links: [
              {
                rel: "self",
                href: "https://example.com/person",
                type: "application/activity+json",
              },
            ],
          });
        }, 1000);
      }),
  );

  await t.step("request cancellation", async () => {
    const controller = new AbortController();
    const promise = lookupObject("johndoe@example.com", {
      ...options,
      signal: controller.signal,
    });

    controller.abort();
    deepStrictEqual(await promise, null);
  });

  fetchMock.removeRoutes();
  fetchMock.get(
    "begin:https://example.com/.well-known/webfinger",
    {
      subject: "acct:johndoe@example.com",
      links: [
        {
          rel: "self",
          href: "https://example.com/person",
          type: "application/activity+json",
        },
      ],
    },
  );

  await t.step("successful request with signal", async () => {
    const controller = new AbortController();
    const person = await lookupObject("johndoe@example.com", {
      ...options,
      signal: controller.signal,
    });
    assertInstanceOf(person, Person);
    deepStrictEqual(person.id, new URL("https://example.com/person"));
  });

  fetchMock.removeRoutes();
  fetchMock.get(
    "begin:https://example.com/.well-known/webfinger",
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            subject: "acct:johndoe@example.com",
            links: [
              {
                rel: "self",
                href: "https://example.com/person",
                type: "application/activity+json",
              },
            ],
          });
        }, 500);
      }),
  );

  await t.step("cancellation with immediate abort", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await lookupObject("johndoe@example.com", {
      ...options,
      signal: controller.signal,
    });
    deepStrictEqual(result, null);
  });

  fetchMock.removeRoutes();
  fetchMock.get(
    "https://example.com/slow-object",
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            status: 200,
            headers: { "Content-Type": "application/activity+json" },
            body: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Note",
              content: "Slow response",
            },
          });
        }, 1000);
      }),
  );

  await t.step("direct object fetch cancellation", async () => {
    const controller = new AbortController();
    const promise = lookupObject("https://example.com/slow-object", {
      contextLoader: mockDocumentLoader,
      signal: controller.signal,
    });

    controller.abort();
    deepStrictEqual(await promise, null);
  });

  fetchMock.hardReset();
  fetchMock.removeRoutes();
});

test("traverseCollection()", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const options = {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
  };
  const collection = await lookupObject(
    "https://example.com/collection",
    options,
  );
  assertInstanceOf(collection, Collection);
  deepStrictEqual(
    await Array.fromAsync(traverseCollection(collection, options)),
    [
      new Note({ content: "This is a simple note" }),
      new Note({ content: "This is another simple note" }),
      new Note({ content: "This is a third simple note" }),
    ],
  );
  const pagedCollection = await lookupObject(
    "https://example.com/paged-collection",
    options,
  );
  assertInstanceOf(pagedCollection, Collection);
  deepStrictEqual(
    await Array.fromAsync(traverseCollection(pagedCollection, options)),
    [
      new Note({ content: "This is a simple note" }),
      new Note({ content: "This is another simple note" }),
      new Note({ content: "This is a third simple note" }),
    ],
  );
  deepStrictEqual(
    await Array.fromAsync(
      traverseCollection(pagedCollection, {
        ...options,
        interval: { milliseconds: 250 },
      }),
    ),
    [
      new Note({ content: "This is a simple note" }),
      new Note({ content: "This is another simple note" }),
      new Note({ content: "This is a third simple note" }),
    ],
  );
});

test("FEP-fe34: lookupObject() cross-origin security", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  await t.step(
    "crossOrigin: ignore (default) - returns null for cross-origin objects",
    async () => {
      // Create a mock document loader that returns an object with different origin
      // deno-lint-ignore require-await
      const crossOriginDocumentLoader = async (url: string) => {
        if (url === "https://example.com/note") {
          return {
            documentUrl: url,
            contextUrl: null,
            document: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Note",
              id: "https://malicious.com/fake-note", // Different origin!
              content: "This is a spoofed note from a different origin",
            },
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const result = await lookupObject("https://example.com/note", {
        documentLoader: crossOriginDocumentLoader,
        contextLoader: mockDocumentLoader,
      });

      // Should return null and log a warning (default behavior)
      deepStrictEqual(result, null);
    },
  );

  await t.step(
    "crossOrigin: throw - throws error for cross-origin objects",
    async () => {
      // deno-lint-ignore require-await
      const crossOriginDocumentLoader = async (url: string) => {
        if (url === "https://example.com/note") {
          return {
            documentUrl: url,
            contextUrl: null,
            document: {
              "@context": "https://www.w3.org/ns/activitystreams",
              type: "Note",
              id: "https://malicious.com/fake-note", // Different origin!
              content: "This is a spoofed note from a different origin",
            },
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      await rejects(
        () =>
          lookupObject("https://example.com/note", {
            documentLoader: crossOriginDocumentLoader,
            contextLoader: mockDocumentLoader,
            crossOrigin: "throw",
          }),
        Error,
        "The object's @id (https://malicious.com/fake-note) has a different origin than the document URL (https://example.com/note)",
      );
    },
  );

  await t.step("crossOrigin: trust - allows cross-origin objects", async () => {
    // deno-lint-ignore require-await
    const crossOriginDocumentLoader = async (url: string) => {
      if (url === "https://example.com/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            id: "https://malicious.com/fake-note", // Different origin!
            content: "This is a spoofed note from a different origin",
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await lookupObject("https://example.com/note", {
      documentLoader: crossOriginDocumentLoader,
      contextLoader: mockDocumentLoader,
      crossOrigin: "trust",
    });

    assertInstanceOf(result, Note);
    deepStrictEqual(result.id, new URL("https://malicious.com/fake-note"));
    deepStrictEqual(
      result.content,
      "This is a spoofed note from a different origin",
    );
  });

  await t.step("same-origin objects are always trusted", async () => {
    // deno-lint-ignore require-await
    const sameOriginDocumentLoader = async (url: string) => {
      if (url === "https://example.com/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            id: "https://example.com/note", // Same origin
            content: "This is a legitimate note from the same origin",
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await lookupObject("https://example.com/note", {
      documentLoader: sameOriginDocumentLoader,
      contextLoader: mockDocumentLoader,
    });

    assertInstanceOf(result, Note);
    deepStrictEqual(result.id, new URL("https://example.com/note"));
    deepStrictEqual(
      result.content,
      "This is a legitimate note from the same origin",
    );
  });

  await t.step("objects without @id are trusted", async () => {
    // deno-lint-ignore require-await
    const noIdDocumentLoader = async (url: string) => {
      if (url === "https://example.com/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            // No @id field
            content: "This is a note without an ID",
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await lookupObject("https://example.com/note", {
      documentLoader: noIdDocumentLoader,
      contextLoader: mockDocumentLoader,
    });

    assertInstanceOf(result, Note);
    deepStrictEqual(result.id, null);
    deepStrictEqual(result.content, "This is a note without an ID");
  });

  await t.step("WebFinger lookup with cross-origin actor URL", async () => {
    fetchMock.spyGlobal();

    // Mock WebFinger response
    fetchMock.get("begin:https://example.com/.well-known/webfinger", {
      subject: "acct:user@example.com",
      links: [
        {
          rel: "self",
          href: "https://different-origin.com/actor", // Cross-origin actor URL
          type: "application/activity+json",
        },
      ],
    });

    // Mock document loader for the cross-origin actor
    // deno-lint-ignore require-await
    const webfingerDocumentLoader = async (url: string) => {
      if (url === "https://different-origin.com/actor") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Person",
            id: "https://malicious.com/fake-actor", // Different origin than document URL!
            name: "Fake Actor",
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    // Default behavior should return null
    const result1 = await lookupObject("@user@example.com", {
      documentLoader: webfingerDocumentLoader,
      contextLoader: mockDocumentLoader,
    });
    deepStrictEqual(result1, null);

    // With crossOrigin: throw, should throw error
    await rejects(
      () =>
        lookupObject("@user@example.com", {
          documentLoader: webfingerDocumentLoader,
          contextLoader: mockDocumentLoader,
          crossOrigin: "throw",
        }),
      Error,
      "The object's @id (https://malicious.com/fake-actor) has a different origin than the document URL (https://different-origin.com/actor)",
    );

    // With crossOrigin: trust, should return the object
    const result2 = await lookupObject("@user@example.com", {
      documentLoader: webfingerDocumentLoader,
      contextLoader: mockDocumentLoader,
      crossOrigin: "trust",
    });
    assertInstanceOf(result2, Person);
    deepStrictEqual(result2.id, new URL("https://malicious.com/fake-actor"));

    fetchMock.removeRoutes();
    fetchMock.hardReset();
  });

  await t.step("subdomain same-origin check", async () => {
    // Test that different subdomains are considered different origins
    // deno-lint-ignore require-await
    const subdomainDocumentLoader = async (url: string) => {
      if (url === "https://api.example.com/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            id: "https://www.example.com/note", // Different subdomain = different origin
            content: "Cross-subdomain note",
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await lookupObject("https://api.example.com/note", {
      documentLoader: subdomainDocumentLoader,
      contextLoader: mockDocumentLoader,
    });

    deepStrictEqual(result, null); // Should be blocked
  });

  await t.step("different port same-origin check", async () => {
    // Test that different ports are considered different origins
    // deno-lint-ignore require-await
    const differentPortDocumentLoader = async (url: string) => {
      if (url === "https://example.com:8080/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            id: "https://example.com:9090/note", // Different port = different origin
            content: "Cross-port note",
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await lookupObject("https://example.com:8080/note", {
      documentLoader: differentPortDocumentLoader,
      contextLoader: mockDocumentLoader,
    });

    deepStrictEqual(result, null); // Should be blocked
  });

  await t.step("protocol difference same-origin check", async () => {
    // Test that different protocols are considered different origins
    // deno-lint-ignore require-await
    const differentProtocolDocumentLoader = async (url: string) => {
      if (url === "https://example.com/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            id: "http://example.com/note", // Different protocol = different origin
            content: "Cross-protocol note",
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await lookupObject("https://example.com/note", {
      documentLoader: differentProtocolDocumentLoader,
      contextLoader: mockDocumentLoader,
    });

    deepStrictEqual(result, null); // Should be blocked
  });

  await t.step("error handling with crossOrigin throw option", async () => {
    // Test that other errors (not cross-origin) are still thrown normally
    // deno-lint-ignore require-await
    const errorDocumentLoader = async (_url: string) => {
      throw new Error("Network error");
    };

    // Network errors should not be confused with cross-origin errors
    const result = await lookupObject("https://example.com/note", {
      documentLoader: errorDocumentLoader,
      contextLoader: mockDocumentLoader,
      crossOrigin: "throw",
    });

    // Should return null because the document loader failed,
    // not because of cross-origin policy
    deepStrictEqual(result, null);
  });

  await t.step("malformed JSON handling with cross-origin policy", async () => {
    // deno-lint-ignore require-await
    const malformedJsonDocumentLoader = async (url: string) => {
      if (url === "https://example.com/note") {
        return {
          documentUrl: url,
          contextUrl: null,
          document: "invalid json", // Malformed document
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    // Should return null for malformed JSON regardless of crossOrigin setting
    deepStrictEqual(
      await lookupObject("https://example.com/note", {
        documentLoader: malformedJsonDocumentLoader,
        contextLoader: mockDocumentLoader,
        crossOrigin: "ignore",
      }),
      null,
    );

    deepStrictEqual(
      await lookupObject("https://example.com/note", {
        documentLoader: malformedJsonDocumentLoader,
        contextLoader: mockDocumentLoader,
        crossOrigin: "throw",
      }),
      null,
    );

    deepStrictEqual(
      await lookupObject("https://example.com/note", {
        documentLoader: malformedJsonDocumentLoader,
        contextLoader: mockDocumentLoader,
        crossOrigin: "trust",
      }),
      null,
    );
  });
});

test("lookupObject() records OpenTelemetry span events", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();

  const object = await lookupObject("https://example.com/object", {
    documentLoader: mockDocumentLoader,
    contextLoader: mockDocumentLoader,
    tracerProvider,
  });

  assertInstanceOf(object, Object);

  // Check that the span was recorded
  const spans = exporter.getSpans("activitypub.lookup_object");
  deepStrictEqual(spans.length, 1);
  const span = spans[0];

  // Check span attributes
  deepStrictEqual(
    span.attributes["activitypub.object.id"],
    "https://example.com/object",
  );

  // Check that the object.fetched event was recorded
  const events = exporter.getEvents(
    "activitypub.lookup_object",
    "activitypub.object.fetched",
  );
  deepStrictEqual(events.length, 1);
  const event = events[0];

  // Verify event attributes
  ok(event.attributes != null);
  ok(typeof event.attributes["activitypub.object.type"] === "string");
  ok(typeof event.attributes["activitypub.object.json"] === "string");

  // Verify the JSON contains the object
  const recordedObject = JSON.parse(
    event.attributes["activitypub.object.json"] as string,
  );
  deepStrictEqual(recordedObject.id, "https://example.com/object");
});

// cSpell: ignore gildong
