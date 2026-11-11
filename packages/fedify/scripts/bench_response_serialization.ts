/**
 * Measures the local serialization overhead of served attachment compatibility.
 *
 * Run from the repository root with:
 * deno run -A packages/fedify/scripts/bench_response_serialization.ts
 *
 * The baseline reproduces the response helper's previous serialization-only
 * pipeline using the same vocabulary objects. It is not an old binary or a
 * network benchmark. Contexts are bundled, no remote I/O is performed, and the
 * response body is consumed in both cases. Each median covers seven batches
 * of thirty requests after fifteen warmup requests.
 */
import {
  Image,
  Note,
  type Object as VocabularyObject,
  OrderedCollectionPage,
  PropertyValue,
  Service,
} from "@fedify/vocab";
import { type DocumentLoader, preloadedContexts } from "@fedify/vocab-runtime";
import { respondWithObject } from "../src/federation/handler.ts";

const contextLoader: DocumentLoader = (url) => {
  if (!globalThis.Object.hasOwn(preloadedContexts, url)) {
    return Promise.reject(
      new Error("Benchmark context is not bundled: " + url),
    );
  }
  return Promise.resolve({
    contextUrl: null,
    documentUrl: url,
    document: preloadedContexts[url],
  });
};

const actor = await Service.fromJsonLd(
  await new Service({
    id: new URL("https://example.com/actors/app"),
    preferredUsername: "app",
    attachments: [
      new PropertyValue({
        name: "Website",
        value: "https://example.com/",
      }),
    ],
  }).toJsonLd(),
  { contextLoader },
);
const items = await Promise.all(
  Array.from({ length: 20 }, async (_, index) =>
    await Note.fromJsonLd(
      await new Note({
        id: new URL(`https://example.com/notes/${index}`),
        content: `Post ${index}`,
        attachments: [
          new Image({
            url: new URL(`https://example.com/images/${index}.png`),
          }),
        ],
      }).toJsonLd(),
      { contextLoader },
    )),
);

/** Creates a fresh page, matching handlers that reuse cached dispatched items. */
function makePage(): OrderedCollectionPage {
  return new OrderedCollectionPage({
    id: new URL("https://example.com/outbox?cursor=1"),
    partOf: new URL("https://example.com/outbox"),
    items,
  });
}

/** Measures rendering and body consumption, excluding setup and warmup. */
async function measure(
  name: string,
  makeObject: () => VocabularyObject,
  compatible: boolean,
): Promise<void> {
  const render = async () => {
    const object = makeObject();
    const response = compatible
      ? await respondWithObject(object, { contextLoader })
      : new Response(
        JSON.stringify(await object.toJsonLd({ contextLoader })),
        { headers: { "Content-Type": "application/activity+json" } },
      );
    await response.text();
  };
  for (let request = 0; request < 15; request++) await render();
  const samples: number[] = [];
  for (let batch = 0; batch < 7; batch++) {
    const start = performance.now();
    for (let request = 0; request < 30; request++) await render();
    samples.push((performance.now() - start) / 30);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({
    name,
    mode: compatible ? "compatibility" : "serialization-only",
    median_ms: samples[3],
    samples_ms: samples,
  }));
}

console.log(JSON.stringify({ deno: Deno.version.deno, arch: Deno.build.arch }));
for (
  const [name, make] of [["actor", () => actor], [
    "outbox20",
    makePage,
  ]] as const
) {
  await measure(name, make, false);
  await measure(name, make, true);
}
