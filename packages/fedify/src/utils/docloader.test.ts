import { mockDocumentLoader, test } from "@fedify/fixture";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
import { assertEquals, assertRejects } from "@std/assert";
import fetchMock from "fetch-mock";
import { verifyRequest } from "../sig/http.ts";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { rsaPrivateKey2 } from "../testing/keys.ts";
import { getAuthenticatedDocumentLoader } from "./docloader.ts";

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

  await t.step("custom max redirection", async () => {
    fetchMock.spyGlobal();
    let requestCount = 0;
    fetchMock.get(
      "begin:https://example.com/custom-too-many-redirects/",
      (cl) => {
        requestCount++;
        const index = Number(cl.url.split("/").at(-1));
        return Response.redirect(
          `https://example.com/custom-too-many-redirects/${index + 1}`,
          302,
        );
      },
    );

    const loader = getAuthenticatedDocumentLoader(
      {
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      },
      { maxRedirection: 1 },
    );
    await assertRejects(
      () => loader("https://example.com/custom-too-many-redirects/0"),
      Error,
      "Too many redirections",
    );
    assertEquals(requestCount, 2);

    fetchMock.hardReset();
  });
});

test("getAuthenticatedDocumentLoader() validates redirects", async (t) => {
  fetchMock.spyGlobal();

  let privateRequestCount = 0;
  fetchMock.get(
    "https://example.com/redirect-to-private",
    () => Response.redirect("http://localhost/private", 302),
  );
  fetchMock.get("http://localhost/private", () => {
    privateRequestCount++;
    return Response.json({ private: true });
  });

  await t.step("deny public-to-private redirects", async () => {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    await assertRejects(
      () => loader("https://example.com/redirect-to-private"),
      UrlError,
    );
    assertEquals(privateRequestCount, 0);
  });

  fetchMock.get(
    "https://example.com/redirect-to-public",
    () => Response.redirect("https://www.example.com/document", 302),
  );
  fetchMock.get(
    "https://www.example.com/document",
    () => Response.json({ public: true }),
  );

  await t.step("allow public-to-public redirects", async () => {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    const remoteDocument = await loader(
      "https://example.com/redirect-to-public",
    );
    assertEquals(remoteDocument.document, { public: true });
  });

  await t.step("allow private redirects when explicitly enabled", async () => {
    const loader = getAuthenticatedDocumentLoader(
      {
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      },
      { allowPrivateAddress: true },
    );
    const remoteDocument = await loader(
      "https://example.com/redirect-to-private",
    );
    assertEquals(remoteDocument.document, { private: true });
    assertEquals(privateRequestCount, 1);
  });

  fetchMock.hardReset();
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

test("getAuthenticatedDocumentLoader() bounds JSON after redirects", async () => {
  fetchMock.mockGlobal();
  let oversized = true;
  try {
    const url = "https://example.com/bounded";
    fetchMock.get(url, {
      status: 302,
      headers: { Location: `${url}/document` },
    });
    fetchMock.get(`${url}/document`, () =>
      new Response('{"name":"hello"}', {
        headers: {
          "Content-Type": "application/activity+json",
          ...(oversized
            ? { "Content-Length": String(16 * 1024 * 1024 + 1) }
            : {}),
        },
      }));
    const identity = {
      privateKey: rsaPrivateKey2,
      keyId: new URL("https://example.com/key2"),
    };
    const loader = getAuthenticatedDocumentLoader(identity, {
      allowPrivateAddress: true,
    });
    await assertRejects(() => loader(url), FetchError);
    oversized = false;
    assertEquals((await loader(url)).document, { name: "hello" });
  } finally {
    fetchMock.hardReset();
  }
});

test("authenticated document loader suppresses HTTP failure logs", async () => {
  const records: LogRecord[] = [];
  const url = "https://example.com/missing-authenticated-document";
  const loader = getAuthenticatedDocumentLoader({
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  }, { allowPrivateAddress: true });
  await reset();
  await configure({
    sinks: { capture: (record) => records.push(record) },
    loggers: [{
      category: ["fedify"],
      lowestLevel: "debug",
      sinks: ["capture"],
    }],
  });
  fetchMock.mockGlobal();
  fetchMock.get(url, { status: 404 });
  try {
    for (const suppressError of [true, false, undefined]) {
      records.length = 0;
      const error = await assertRejects(
        () => loader(url, { suppressError }),
        FetchError,
      );
      assertEquals(error.response?.status, 404);
      const failures = records.filter((record) =>
        record.rawMessage ===
          "Failed to fetch document: {status} {url} {headers}"
      );
      assertEquals(failures.length, 1);
      assertEquals(failures[0].level, suppressError ? "warning" : "error");
      if (suppressError) {
        assertEquals(records.filter((record) => record.level === "error"), []);
      }
    }
  } finally {
    fetchMock.hardReset();
    await reset();
  }
});

test("authenticated document loader suppresses private URL logs", async () => {
  const records: LogRecord[] = [];
  const loader = getAuthenticatedDocumentLoader({
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  });
  await reset();
  await configure({
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [{
      category: ["fedify"],
      lowestLevel: "debug",
      sinks: ["capture"],
    }],
  });
  fetchMock.spyGlobal();
  let requests = 0;
  fetchMock.get("https://example.com/private-redirect", () => {
    requests++;
    return Response.redirect("http://127.0.0.1/private", 302);
  });
  try {
    for (
      const url of [
        "http://127.0.0.1/private",
        "https://example.com/private-redirect",
      ]
    ) {
      for (const suppressError of [true, false, undefined]) {
        records.length = 0;
        requests = 0;
        await assertRejects(() => loader(url, { suppressError }), UrlError);
        const failures = records.filter((r) =>
          r.rawMessage === "Disallowed private URL: {url}"
        );
        assertEquals(failures.length, 1);
        assertEquals(failures[0].level, suppressError ? "warning" : "error");
        assertEquals(requests, url.startsWith("http://127") ? 0 : 1);
      }
    }
  } finally {
    fetchMock.hardReset();
    await reset();
  }
});
