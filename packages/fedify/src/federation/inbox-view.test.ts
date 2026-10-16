import { test } from "@fedify/fixture";
import {
  type DocumentLoader,
  getDocumentLoader,
  preloadedContexts,
} from "@fedify/vocab-runtime";
import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import {
  buildVerifiedActivityView,
  ContextSnapshotMissError,
  createContextSnapshot,
  createReleasableLoader,
  createSnapshotOnlyLoader,
  deserializeContextSnapshot,
  expandDocument,
  getActorPresence,
  getPropertyValues,
  restoreVerifiedActivityView,
  serializeContextSnapshot,
} from "./inbox-view.ts";

const AS = "https://www.w3.org/ns/activitystreams";
const CUSTOM = "https://remote.example/contexts/custom";

function createMutableLoader(): { loader: DocumentLoader; loads: string[] } {
  const loads: string[] = [];
  const preloaded = getDocumentLoader();
  return {
    loads,
    loader: (url, options) => {
      loads.push(url);
      if (url === CUSTOM) {
        const n = loads.filter((u) => u === CUSTOM).length;
        return Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              tgt: {
                "@id": n % 2 === 1 ? `${AS}#object` : `${AS}#target`,
                "@type": "@id",
              },
            },
          },
        });
      }
      return preloaded(url, options);
    },
  };
}

test("createContextSnapshot() memoizes responses for a delivery", async () => {
  const { loader, loads } = createMutableLoader();
  const snapshot = createContextSnapshot(loader);
  const standard = snapshot.loader("standard");
  const first = await standard(CUSTOM);
  const second = await standard(CUSTOM);
  assertEquals(first, second);
  assertEquals(loads.filter((url) => url === CUSTOM).length, 1);
  // Responses are cloned, so a caller cannot change what others see:
  (first.document as Record<string, unknown>)["@context"] = null;
  assertEquals((await standard(CUSTOM)).document, second.document);
  assertEquals(
    snapshot.entries().map((entry) => [entry.policy, entry.url]),
    [["standard", CUSTOM]],
  );
  // After the delivery, the loader passes through:
  snapshot.release();
  await standard(CUSTOM);
  assertEquals(loads.filter((url) => url === CUSTOM).length, 2);
});

test("createContextSnapshot() memoizes failures for a delivery", async () => {
  let calls = 0;
  const snapshot = createContextSnapshot((url) => {
    calls++;
    return calls === 1
      ? Promise.reject(new TypeError("fetch failed"))
      : Promise.resolve({ contextUrl: null, documentUrl: url, document: {} });
  });
  const loader = snapshot.loader("standard");
  await assertRejects(() => loader(CUSTOM), TypeError);
  await assertRejects(() => loader(CUSTOM), TypeError);
  assertEquals(calls, 1);
  assertEquals(snapshot.entries(), []);
});

test("createContextSnapshot() records the normalization overrides", async () => {
  const snapshot = createContextSnapshot(() =>
    Promise.reject(new Error("The caller's loader must not be asked."))
  );
  const loader = snapshot.loader("normalization");
  await loader("https://w3id.org/security/v1");
  assertEquals(
    snapshot.entries().map((entry) => [entry.policy, entry.url]),
    [["normalization", "https://w3id.org/security/v1"]],
  );
  const [entry] = await serializeContextSnapshot(snapshot.entries());
  assert("bundled" in entry && entry.bundled);
});

test("serializeContextSnapshot() stores only exactly bundled responses by hash", async () => {
  const bundled = {
    contextUrl: null,
    documentUrl: AS,
    document: preloadedContexts[AS],
  };
  const serialized = await serializeContextSnapshot([
    { policy: "standard", url: AS, response: bundled },
    // The same document served from another location is not the bundled
    // response:
    {
      policy: "standard",
      url: "https://www.w3.org/ns/activitystreams",
      response: { ...bundled, documentUrl: "https://mirror.example/as" },
    },
    // A caller's own version of a known context is kept as is:
    {
      policy: "standard",
      url: AS,
      response: { ...bundled, document: { "@context": {} } },
    },
  ]);
  assert("bundled" in serialized[0]);
  assert("response" in serialized[1]);
  assert("response" in serialized[2]);
  const restored = await deserializeContextSnapshot(
    JSON.parse(JSON.stringify(serialized)),
  );
  assertEquals(restored[0].response.document, preloadedContexts[AS]);
  assertEquals(restored[1].response.documentUrl, "https://mirror.example/as");
  assertEquals(restored[2].response.document, { "@context": {} });
});

test("deserializeContextSnapshot() rejects tampered or unknown entries", async () => {
  const [entry] = await serializeContextSnapshot([{
    policy: "standard",
    url: CUSTOM,
    response: { contextUrl: null, documentUrl: CUSTOM, document: { a: 1 } },
  }]);
  await assertRejects(
    () =>
      deserializeContextSnapshot([{
        ...entry,
        response: {
          contextUrl: null,
          documentUrl: CUSTOM,
          document: { a: 2 },
        },
      }]),
    ContextSnapshotMissError,
  );
  await assertRejects(
    () =>
      deserializeContextSnapshot([{
        policy: "standard",
        url: CUSTOM,
        sha256: entry.sha256,
        bundled: true,
      }]),
    ContextSnapshotMissError,
  );
  await assertRejects(
    () => deserializeContextSnapshot([{ url: CUSTOM }]),
    ContextSnapshotMissError,
  );
  await assertRejects(
    () => deserializeContextSnapshot("nope"),
    ContextSnapshotMissError,
  );
});

test("createSnapshotOnlyLoader() serves only the snapshot", async () => {
  const loader = createSnapshotOnlyLoader([{
    policy: "standard",
    url: CUSTOM,
    response: { contextUrl: null, documentUrl: CUSTOM, document: { a: 1 } },
  }], "standard");
  assertEquals((await loader(CUSTOM)).document, { a: 1 });
  await assertRejects(() => loader(AS), ContextSnapshotMissError);
  const normalization = createSnapshotOnlyLoader([{
    policy: "standard",
    url: CUSTOM,
    response: { contextUrl: null, documentUrl: CUSTOM, document: { a: 1 } },
  }], "normalization");
  await assertRejects(() => normalization(CUSTOM), ContextSnapshotMissError);
});

test("createReleasableLoader() is strict until released", async () => {
  const strict: DocumentLoader = () => Promise.reject(new Error("strict"));
  const fallback: DocumentLoader = (url) =>
    Promise.resolve({ contextUrl: null, documentUrl: url, document: {} });
  const releasable = createReleasableLoader(strict, fallback, "standard");
  await assertRejects(() => releasable.loader(CUSTOM), Error, "strict");
  releasable.release();
  assertEquals((await releasable.loader(CUSTOM)).document, {});
});

test("getActorPresence() counts every declared actor value", async () => {
  const expand = (actor?: unknown) =>
    expandDocument(
      {
        "@context": AS,
        id: "https://example.com/activities/1",
        type: "Create",
        ...(actor === undefined ? {} : { actor }),
      },
      getDocumentLoader(),
    );
  assertEquals(getActorPresence(await expand()), "absent");
  assertEquals(getActorPresence(await expand([])), "absent");
  assertEquals(getActorPresence(await expand({ "@list": [] })), "absent");
  for (
    const actor of [
      "https://example.com/users/alice",
      { type: "Person", name: "Anonymous" },
      { name: "Anonymous" },
      { id: "_:b0" },
      { "@list": [{ name: "Anonymous" }] },
    ]
  ) {
    assertEquals(getActorPresence(await expand(actor)), "present");
  }
  assertEquals(getActorPresence([]), "present");
});

test("getPropertyValues() unwraps a single list like the decoders", () => {
  const node = {
    a: [{ "@list": [{ "@id": "x" }, { "@id": "y" }] }],
    b: [{ "@id": "x" }, { "@list": [] }],
  };
  assertEquals(getPropertyValues(node, "a").length, 2);
  assertEquals(getPropertyValues(node, "b").length, 2);
  assertEquals(getPropertyValues(node, "c"), []);
});

test("restoreVerifiedActivityView() replays the authenticated interpretation", async () => {
  const { loader, loads } = createMutableLoader();
  const document = {
    "@context": [AS, CUSTOM],
    id: "https://example.com/activities/1",
    type: "Create",
    tgt: "https://example.com/notes/1",
  };
  const snapshot = createContextSnapshot(loader);
  const { view, expanded } = await buildVerifiedActivityView(snapshot, {
    policy: "standard",
    source: "activity",
    document,
    baseUrl: null,
  });
  const queued = JSON.parse(JSON.stringify(view));
  const loadsBefore = loads.length;
  const restored = await restoreVerifiedActivityView(queued, {
    activity: document,
  });
  assertEquals(loads.length, loadsBefore);
  assertEquals(restored.expanded, expanded);
  assertEquals(
    getPropertyValues(restored.expanded[0], `${AS}#object`).length,
    1,
  );
  // A view whose digest does not match is never replayed:
  await assertRejects(
    () =>
      restoreVerifiedActivityView({ ...queued, expandedDigest: "0" }, {
        activity: document,
      }),
    ContextSnapshotMissError,
  );
  // Nor one whose document changed:
  await assertRejects(
    () =>
      restoreVerifiedActivityView(queued, {
        activity: { ...document, tgt: "https://example.com/notes/2" },
      }),
    ContextSnapshotMissError,
  );
  // Nor one whose normalized document is missing:
  await assertRejects(
    () =>
      restoreVerifiedActivityView(
        { ...queued, source: "normalizedActivity" },
        { activity: document },
      ),
    ContextSnapshotMissError,
  );
});

test("restoreVerifiedActivityView() survives changes to unused bundled terms", async () => {
  const document = {
    "@context": [AS, "http://joinmastodon.org/ns"],
    id: "https://example.com/likes/1",
    type: "Like",
    object: "https://example.com/notes/1",
  };
  const snapshot = createContextSnapshot(getDocumentLoader());
  const { view, expanded } = await buildVerifiedActivityView(snapshot, {
    policy: "standard",
    source: "activity",
    document,
    baseUrl: null,
  });
  const mastodon = view.contexts.find((entry) =>
    entry.url === "http://joinmastodon.org/ns"
  );
  assert(mastodon != null && "bundled" in mastodon);
  // A newer version of Fedify bundles a context that differs from the one
  // the message was queued with, as far as the activity does not use it:
  const queued = {
    ...view,
    contexts: view.contexts.map((entry) =>
      entry === mastodon ? { ...entry, sha256: "0".repeat(64) } : entry
    ),
  };
  const restored = await restoreVerifiedActivityView(queued, {
    activity: document,
  });
  assertEquals(restored.expanded, expanded);
});

test("buildVerifiedActivityView() keeps only the contexts it uses", async () => {
  const { loader } = createMutableLoader();
  const snapshot = createContextSnapshot(loader);
  // Another step of the delivery, e.g., parsing a key document, loads
  // a context through the same snapshot:
  await snapshot.loader("standard")("https://w3id.org/security/v1");
  const { view } = await buildVerifiedActivityView(snapshot, {
    policy: "standard",
    source: "activity",
    document: {
      "@context": [AS, CUSTOM],
      id: "https://example.com/activities/1",
      type: "Create",
      tgt: "https://example.com/notes/1",
    },
    baseUrl: null,
  });
  assertEquals(
    view.contexts.map((entry) => entry.url).sort(),
    [
      CUSTOM,
      AS,
    ].sort(),
  );
});

test("createContextSnapshot() keeps contexts out of jsonld.js's shared cache", async () => {
  let loads = 0;
  const document = {
    "@context": [AS, "https://remote.example/contexts/static"],
    id: "https://example.com/activities/static",
    type: "Create",
  };
  const tagging: DocumentLoader = (url, options) => {
    if (url !== "https://remote.example/contexts/static") {
      return getDocumentLoader()(url, options);
    }
    loads++;
    // A response tagged "static" is cached by jsonld.js across operations:
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: { "@context": { x: "https://example.com/x" } },
      tag: "static",
    } as Awaited<ReturnType<DocumentLoader>>);
  };
  for (let i = 0; i < 2; i++) {
    const { view } = await buildVerifiedActivityView(
      createContextSnapshot(tagging),
      { policy: "standard", source: "activity", document, baseUrl: null },
    );
    assert(
      view.contexts.some((entry) =>
        entry.url === "https://remote.example/contexts/static"
      ),
    );
  }
  assertEquals(loads, 2);
});

test("buildVerifiedActivityView() tells contexts it could not record", async () => {
  const cached = "https://remote.example/contexts/shared-cache";
  const preloaded = getDocumentLoader();
  // Some other code expands a document with a loader that tags a context
  // "static", so jsonld.js keeps it in a cache shared across operations:
  await expandDocument(
    { "@context": cached, "y": "z" },
    (url, options) =>
      url === cached
        ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: { "@context": { y: "https://example.com/y" } },
          tag: "static",
        } as Awaited<ReturnType<DocumentLoader>>)
        : preloaded(url, options),
  );
  const build = (document: unknown) =>
    buildVerifiedActivityView(createContextSnapshot(preloaded), {
      policy: "standard",
      source: "activity",
      document,
      baseUrl: null,
    });
  // The expansion takes the context from that cache without asking the
  // snapshot, so a worker in another process could not replay it:
  const { replayable, view } = await build({
    "@context": [AS, cached],
    id: "https://example.com/activities/cached",
    type: "Create",
  });
  assertEquals(replayable, false);
  assertFalse(view.contexts.some((entry) => entry.url === cached));
  assertEquals(
    (await build({
      "@context": AS,
      id: "https://example.com/activities/plain",
      type: "Create",
    })).replayable,
    true,
  );
});

test("buildVerifiedActivityView() tells contexts linked from a context", async () => {
  const cached = "https://remote.example/contexts/linked-shared-cache";
  const linking = "https://remote.example/contexts/linking";
  const preloaded = getDocumentLoader();
  await expandDocument(
    { "@context": cached, "w": "z" },
    (url, options) =>
      url === cached
        ? Promise.resolve({
          contextUrl: null,
          documentUrl: url,
          document: { "@context": { w: "https://example.com/w" } },
          tag: "static",
        } as Awaited<ReturnType<DocumentLoader>>)
        : preloaded(url, options),
  );
  // The snapshot serves a context whose Link header names the cached one,
  // which jsonld.js appends to it and takes from its shared cache:
  const { replayable, view } = await buildVerifiedActivityView(
    createContextSnapshot((url, options) =>
      url === linking
        ? Promise.resolve({
          contextUrl: cached,
          documentUrl: url,
          document: { "@context": { v: "https://example.com/v" } },
        })
        : preloaded(url, options)
    ),
    {
      policy: "standard",
      source: "activity",
      document: {
        "@context": [AS, linking],
        id: "https://example.com/activities/linked",
        type: "Create",
      },
      baseUrl: null,
    },
  );
  assert(view.contexts.some((entry) => entry.url === linking));
  assertFalse(view.contexts.some((entry) => entry.url === cached));
  assertEquals(replayable, false);
});
