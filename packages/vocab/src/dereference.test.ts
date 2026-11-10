import {
  createTestTracerProvider,
  mockDocumentLoader,
  test,
} from "@fedify/fixture";
import type { DocumentLoader } from "@fedify/vocab-runtime";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { Create, Note } from "./vocab.ts";

const objectId = new URL("https://example.com/notes/1");

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
