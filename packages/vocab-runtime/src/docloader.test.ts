import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects } from "node:assert";
import { test } from "node:test";
import preloadedContexts from "./contexts.ts";
import { getDocumentLoader } from "./docloader.ts";
import { FetchError } from "./request.ts";
import { UrlError } from "./url.ts";

test("new FetchError()", () => {
  const e = new FetchError("https://example.com/", "An error message.");
  deepStrictEqual(e.name, "FetchError");
  deepStrictEqual(e.url, new URL("https://example.com/"));
  deepStrictEqual(e.message, "https://example.com/: An error message.");

  const e2 = new FetchError(new URL("https://example.org/"));
  deepStrictEqual(e2.url, new URL("https://example.org/"));
  deepStrictEqual(e2.message, "https://example.org/");
});

test("getDocumentLoader()", async (t) => {
  const fetchDocumentLoader = getDocumentLoader();

  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/object", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/object",
      name: "Fetched object",
      type: "Object",
    },
  });

  await t.test("ok", async () => {
    deepStrictEqual(await fetchDocumentLoader("https://example.com/object"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  fetchMock.get("https://example.com/link-ctx", {
    body: {
      id: "https://example.com/link-ctx",
      name: "Fetched object",
      type: "Object",
    },
    headers: {
      "Content-Type": "application/activity+json",
      Link: "<https://www.w3.org/ns/activitystreams>; " +
        'rel="http://www.w3.org/ns/json-ld#context"; ' +
        'type="application/ld+json"',
    },
  });

  fetchMock.get("https://example.com/link-obj", {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: '<https://example.com/object>; rel="alternate"; ' +
        'type="application/activity+json"',
    },
  });

  fetchMock.get("https://example.com/link-obj-relative", {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: '</object>; rel="alternate"; ' +
        'type="application/activity+json"',
    },
  });

  fetchMock.get("https://example.com/obj-w-wrong-link", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/obj-w-wrong-link",
      name: "Fetched object",
      type: "Object",
    },
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Link: '<https://example.com/object>; rel="alternate"; ' +
        'type="application/ld+json; profile="https://www.w3.org/ns/activitystreams""',
    },
  });

  await t.test("Link header", async () => {
    deepStrictEqual(await fetchDocumentLoader("https://example.com/link-ctx"), {
      contextUrl: "https://www.w3.org/ns/activitystreams",
      documentUrl: "https://example.com/link-ctx",
      document: {
        id: "https://example.com/link-ctx",
        name: "Fetched object",
        type: "Object",
      },
    });

    deepStrictEqual(await fetchDocumentLoader("https://example.com/link-obj"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  await t.test("Link header relative url", async () => {
    deepStrictEqual(await fetchDocumentLoader("https://example.com/link-ctx"), {
      contextUrl: "https://www.w3.org/ns/activitystreams",
      documentUrl: "https://example.com/link-ctx",
      document: {
        id: "https://example.com/link-ctx",
        name: "Fetched object",
        type: "Object",
      },
    });

    deepStrictEqual(
      await fetchDocumentLoader("https://example.com/link-obj-relative"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/object",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/object",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  await t.test("wrong Link header syntax", async () => {
    deepStrictEqual(
      await fetchDocumentLoader("https://example.com/obj-w-wrong-link"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/obj-w-wrong-link",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/obj-w-wrong-link",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  fetchMock.get("https://example.com/html-link", {
    body: `<html>
        <head>
          <meta charset=utf-8>
          <link
            rel=alternate
            type='application/activity+json'
            href="https://example.com/object">
        </head>
      </html>`,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.test("HTML <link>", async () => {
    deepStrictEqual(
      await fetchDocumentLoader("https://example.com/html-link"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/object",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/object",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  fetchMock.get("https://example.com/xhtml-link", {
    body: `<html>
        <head>
          <meta charset="utf-8" />
          <link
            rel=alternate
            type="application/activity+json"
            href="https://example.com/object" />
        </head>
      </html>`,
    headers: { "Content-Type": "application/xhtml+xml; charset=utf-8" },
  });

  await t.test("XHTML <link>", async () => {
    deepStrictEqual(
      await fetchDocumentLoader("https://example.com/xhtml-link"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/object",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/object",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  fetchMock.get("https://example.com/html-a", {
    body: `<html>
        <head>
          <meta charset=utf-8>
        </head>
        <body>
          <a
            rel=alternate
            type=application/activity+json
            href=https://example.com/object>test</a>
        </body>
      </html>`,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.test("HTML <a>", async () => {
    deepStrictEqual(await fetchDocumentLoader("https://example.com/html-a"), {
      contextUrl: null,
      documentUrl: "https://example.com/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://example.com/object",
        name: "Fetched object",
        type: "Object",
      },
    });
  });

  fetchMock.get("https://example.com/wrong-content-type", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/wrong-content-type",
      name: "Fetched object",
      type: "Object",
    },
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.test("Wrong Content-Type", async () => {
    deepStrictEqual(
      await fetchDocumentLoader("https://example.com/wrong-content-type"),
      {
        contextUrl: null,
        documentUrl: "https://example.com/wrong-content-type",
        document: {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://example.com/wrong-content-type",
          name: "Fetched object",
          type: "Object",
        },
      },
    );
  });

  fetchMock.get("https://example.com/404", { status: 404 });

  await t.test("not ok", async () => {
    await rejects(
      () => fetchDocumentLoader("https://example.com/404"),
      FetchError,
      "HTTP 404: https://example.com/404",
    );
  });

  await t.test("preloaded contexts", async () => {
    for (const [url, document] of Object.entries(preloadedContexts)) {
      deepStrictEqual(await fetchDocumentLoader(url), {
        contextUrl: null,
        documentUrl: url,
        document,
      });
    }
  });

  await t.test("deny non-HTTP/HTTPS", async () => {
    await rejects(
      () => fetchDocumentLoader("ftp://localhost"),
      UrlError,
    );
  });

  fetchMock.get("https://example.com/localhost-redirect", {
    status: 302,
    headers: { Location: "https://localhost/object" },
  });

  fetchMock.get("https://example.com/localhost-link", {
    body: `<html>
        <head>
          <meta charset=utf-8>
          <link
            rel=alternate
            type='application/activity+json'
            href="https://localhost/object">
        </head>
      </html>`,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  fetchMock.get("https://localhost/object", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://localhost/object",
      name: "Fetched object",
      type: "Object",
    },
  });

  await t.test("allowPrivateAddress: false", async () => {
    await rejects(
      () => fetchDocumentLoader("https://localhost/object"),
      UrlError,
    );
    await rejects(
      () => fetchDocumentLoader("https://example.com/localhost-redirect"),
      UrlError,
    );
    await rejects(
      () => fetchDocumentLoader("https://example.com/localhost-link"),
      UrlError,
    );
  });

  const fetchDocumentLoader2 = getDocumentLoader({ allowPrivateAddress: true });

  await t.test("allowPrivateAddress: true", async () => {
    const expected = {
      contextUrl: null,
      documentUrl: "https://localhost/object",
      document: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: "https://localhost/object",
        name: "Fetched object",
        type: "Object",
      },
    };
    deepStrictEqual(
      await fetchDocumentLoader2("https://localhost/object"),
      expected,
    );
    deepStrictEqual(
      await fetchDocumentLoader2("https://example.com/localhost-redirect"),
      expected,
    );
    deepStrictEqual(
      await fetchDocumentLoader2("https://example.com/localhost-link"),
      expected,
    );
  });

  // Regression test for ReDoS vulnerability (CVE-2025-68475)
  // Malicious HTML payload: <a a="b" a="b" ... (unclosed tag)
  // With the vulnerable regex, this causes catastrophic backtracking
  const maliciousPayload = "<a" + ' a="b"'.repeat(30) + " ";

  fetchMock.get("https://example.com/redos", {
    body: maliciousPayload,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.test("ReDoS resistance (CVE-2025-68475)", async () => {
    const start = performance.now();
    // The malicious HTML will fail JSON parsing, but the important thing is
    // that it should complete quickly (not hang due to ReDoS)
    await rejects(
      () => fetchDocumentLoader("https://example.com/redos"),
      SyntaxError,
    );
    const elapsed = performance.now() - start;

    // Should complete in under 1 second. With the vulnerable regex,
    // this would take 14+ seconds for 30 repetitions.
    ok(
      elapsed < 1000,
      `Potential ReDoS vulnerability detected: ${elapsed}ms (expected < 1000ms)`,
    );
  });

  fetchMock.hardReset();
});
