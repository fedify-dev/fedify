import { assertEquals, assertRejects } from "@std/assert";
import fetchMock from "fetch-mock";
import { verifyRequest } from "../sig/http.ts";
import { mockDocumentLoader } from "../testing/docloader.ts";
import { rsaPrivateKey2 } from "../testing/keys.ts";
import { test } from "../testing/mod.ts";
import { getAuthenticatedDocumentLoader } from "./authdocloader.ts";
import { UrlError } from "./url.ts";

test("getAuthenticatedDocumentLoader()", async (t) => {
  fetchMock.spyGlobal();

  fetchMock.get(
    "begin:https://example.com/object",
    async (cl) => {
      const v = await verifyRequest(
        cl.request!,
        {
          documentLoader: mockDocumentLoader,
          contextLoader: mockDocumentLoader,
          currentTime: Temporal.Now.instant(),
        },
      );
      return new Response(JSON.stringify(v != null), {
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  await t.step("test", async () => {
    const loader = await getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    assertEquals(await loader("https://example.com/object"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: true,
    });
  });

  fetchMock.hardReset();

  await t.step("deny non-HTTP/HTTPS", async () => {
    const loader = await getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    assertRejects(() => loader("ftp://localhost"), UrlError);
  });

  await t.step("deny private network", async () => {
    const loader = await getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    assertRejects(() => loader("http://localhost"), UrlError);
  });
});

test("getAuthenticatedDocumentLoader() cancellation", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  fetchMock.spyGlobal();

  await t.step("document loader cancellation", async () => {
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

    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });

    const controller = new AbortController();
    const promise = loader("https://example.com/slow-object", {
      signal: controller.signal,
    });

    controller.abort();

    await assertRejects(
      () => promise,
      Error,
    );

    await assertRejects(
      () => loader("https://example.com/object", { signal: controller.signal }),
      Error,
    );
  });

  await t.step("immediate cancellation", async () => {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });

    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      () => loader("https://example.com/object", { signal: controller.signal }),
      Error,
    );
  });

  fetchMock.hardReset();
});
