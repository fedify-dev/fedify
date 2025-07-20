import { assertEquals, assertInstanceOf } from "@std/assert";
import fetchMock from "fetch-mock";
import { mockDocumentLoader } from "../testing/docloader.ts";
import { test } from "../testing/mod.ts";
import { lookupObject, traverseCollection } from "./lookup.ts";
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
    assertEquals(person.id, new URL("https://example.com/person"));
    assertEquals(person.name, "John Doe");
    const person2 = await lookupObject("johndoe@example.com", options);
    assertEquals(person2, person);
    const person3 = await lookupObject("acct:johndoe@example.com", options);
    assertEquals(person3, person);
  });

  await t.step("object", async () => {
    const object = await lookupObject("https://example.com/object", options);
    assertInstanceOf(object, Object);
    assertEquals(
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
    assertEquals(
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
    assertEquals(await lookupObject("janedoe@example.com", options), null);
    assertEquals(await lookupObject("https://example.com/404", options), null);
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
    assertEquals(await promise, null);
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
    assertEquals(person.id, new URL("https://example.com/person"));
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
    assertEquals(result, null);
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
    assertEquals(await promise, null);
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
  assertEquals(
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
  assertEquals(
    await Array.fromAsync(traverseCollection(pagedCollection, options)),
    [
      new Note({ content: "This is a simple note" }),
      new Note({ content: "This is another simple note" }),
      new Note({ content: "This is a third simple note" }),
    ],
  );
  assertEquals(
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

// cSpell: ignore gildong
