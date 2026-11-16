import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import type { DocumentLoader, RemoteDocument } from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert/strict";
import { Create, Note } from "./vocab.ts";

const objectId = new URL("https://example.com/notes/1");

test("onAcceptedDocument reports exact fetched instances without replaying cache hits", async () => {
  const response: RemoteDocument = {
    contextUrl: null,
    documentUrl: objectId.href,
    document: {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Note",
      id: objectId.href,
    },
  };
  const activity = new Create({ object: objectId });
  const accepted: [unknown, RemoteDocument][] = [];
  let loads = 0;
  const options = {
    documentLoader: () => {
      loads++;
      return Promise.resolve(response);
    },
    contextLoader: mockDocumentLoader,
    onAcceptedDocument: (target: unknown, document: RemoteDocument) => {
      strictEqual(accepted.length, 0);
      // The parent is not hydrated until after callback delivery.
      strictEqual(activity.objectId, objectId);
      accepted.push([target, document]);
    },
  };
  const targets = await Array.fromAsync(activity.getObjects(options));
  strictEqual(targets.length, 1);
  strictEqual(accepted.length, 1);
  strictEqual(accepted[0][0], targets[0]);
  strictEqual(accepted[0][1], response);
  const cached = await Array.fromAsync(activity.getObjects(options));
  strictEqual(cached[0], targets[0]);
  strictEqual(accepted.length, 1);
  strictEqual(loads, 1);
});

test("onAcceptedDocument skips embedded targets, disabled fetches, and singular cache hits", async () => {
  const embedded = new Note({ content: "Embedded" });
  const activity = new Create({ objects: [objectId, embedded] });
  let calls = 0;
  let loads = 0;
  const options = {
    documentLoader: (url: string) => {
      loads++;
      return Promise.resolve({
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Note",
          id: url,
        },
      });
    },
    contextLoader: mockDocumentLoader,
    onAcceptedDocument: () => {
      calls++;
    },
  };
  deepStrictEqual(
    await Array.fromAsync(
      activity.getObjects({ ...options, dereference: false }),
    ),
    [embedded],
  );
  strictEqual(loads, 0);
  const fetched = await activity.getObject(options);
  ok(fetched instanceof Note);
  const targets = await Array.fromAsync(activity.getObjects(options));
  strictEqual(targets[0], fetched);
  strictEqual(targets[1], embedded);
  strictEqual(loads, 1);
  strictEqual(calls, 0);
});

test("onAcceptedDocument ignores suppressed parse failures", async () => {
  const activity = new Create({ object: objectId });
  let calls = 0;
  let loads = 0;
  const targets = await Array.fromAsync(
    activity.getObjects({
      suppressError: true,
      documentLoader: () => {
        loads++;
        return Promise.resolve({
          contextUrl: null,
          documentUrl: objectId.href,
          document: {
            "@context": "https://www.w3.org/ns/activitystreams",
            type: "Note",
            id: 42,
          },
        });
      },
      contextLoader: mockDocumentLoader,
      onAcceptedDocument: () => {
        calls++;
      },
    }),
  );
  deepStrictEqual(targets, []);
  strictEqual(loads, 1);
  strictEqual(calls, 0);
});

test("onAcceptedDocument exceptions propagate under suppressError and retries fetch again", async () => {
  const activity = new Create({ object: objectId });
  const failure = new Error("Callback failed");
  let loads = 0;
  let calls = 0;
  const options = {
    suppressError: true,
    documentLoader: (url: string) => {
      loads++;
      return Promise.resolve({
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Note",
          id: url,
        },
      });
    },
    contextLoader: mockDocumentLoader,
    onAcceptedDocument: () => {
      calls++;
      if (calls === 1) throw failure;
    },
  };
  await rejects(
    Array.fromAsync(activity.getObjects(options)),
    (error) => error === failure,
  );
  strictEqual(loads, 1);
  const targets = await Array.fromAsync(activity.getObjects(options));
  strictEqual(targets.length, 1);
  strictEqual(loads, 2);
  strictEqual(calls, 2);
});

test("onAcceptedDocument reports unverified portable claims on every fetching pass", async () => {
  const activity = new Create({ object: objectId });
  const targets: unknown[] = [];
  const responses: RemoteDocument[] = [];
  let loads = 0;
  const options = {
    crossOrigin: "trust" as const,
    documentLoader: (url: string) => {
      loads++;
      const response = {
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Note",
          id: "ap://did:key:z6Mkabc/note",
        },
      };
      responses.push(response);
      return Promise.resolve(response);
    },
    contextLoader: mockDocumentLoader,
    onAcceptedDocument: (target: unknown, response: RemoteDocument) => {
      strictEqual(response, responses[targets.length]);
      targets.push(target);
    },
  };
  for (let i = 0; i < 2; i++) {
    const fetched = await Array.fromAsync(activity.getObjects(options));
    strictEqual(fetched.length, 1);
    strictEqual(fetched[0], targets[i]);
    strictEqual(targets.length, i + 1);
  }
  strictEqual(loads, 2);
});

test("dereference: false skips references without lookup spans or hydration", async () => {
  const [tracerProvider, exporter] = createTestTracerProvider();
  const requests: string[] = [];
  const documentLoader: DocumentLoader = (url) => {
    requests.push(url);
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Note",
        id: url,
      },
    });
  };
  const activity = new Create({ object: objectId });
  const options = {
    documentLoader,
    contextLoader: mockDocumentLoader,
    tracerProvider,
  };
  strictEqual(
    await activity.getObject({ ...options, dereference: false }),
    null,
  );
  deepStrictEqual(requests, []);
  deepStrictEqual(exporter.getSpans("activitypub.lookup_object"), []);
  const fetched = await activity.getObject(options);
  ok(fetched instanceof Note);
  deepStrictEqual(requests, [objectId.href]);
  strictEqual(
    await activity.getObject({ ...options, dereference: false }),
    fetched,
  );
  await tracerProvider.shutdown();
});

test("plural accessors skip references and retain embedded and cached objects", async () => {
  const embedded = new Note({ content: "Embedded" });
  const activity = new Create({ objects: [objectId, embedded] });
  deepStrictEqual(
    await Array.fromAsync(activity.getObjects({ dereference: false })),
    [embedded],
  );
  const fetched = await activity.getObject({
    documentLoader: (url) =>
      Promise.resolve({
        contextUrl: null,
        documentUrl: url,
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Note",
          id: url,
        },
      }),
    contextLoader: mockDocumentLoader,
    dereference: true,
  });
  deepStrictEqual(
    await Array.fromAsync(activity.getObjects({ dereference: false })),
    [fetched, embedded],
  );
});

for (const portable of [false, true]) {
  test(`dereference: false preserves ${portable ? "portable verification" : "origin"} checks`, async () => {
    let loads = 0;
    let verifications = 0;
    const activity = await Create.fromJsonLd(
      {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Create",
        id: "https://example.com/create",
        object: {
          type: "Note",
          id: portable
            ? "ap://did:key:z6Mkabc/note"
            : "https://other.example/note",
        },
      },
      {
        contextLoader: mockDocumentLoader,
        verifyPortableObject: portable
          ? () => {
              verifications++;
              return Promise.resolve({ verified: false });
            }
          : undefined,
      },
    );
    const options = {
      dereference: false,
      documentLoader: () => {
        loads++;
        throw new Error("Unexpected fetch");
      },
    };
    strictEqual(await activity.getObject(options), null);
    deepStrictEqual(await Array.fromAsync(activity.getObjects(options)), []);
    const trusted = await activity.getObject({
      ...options,
      crossOrigin: "trust",
    });
    strictEqual(trusted == null, portable);
    strictEqual(loads, 0);
    strictEqual(verifications, 0);
  });
}
