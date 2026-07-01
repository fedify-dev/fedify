import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects } from "node:assert";
import { test } from "node:test";
import preloadedContexts from "./contexts.ts";
import { getDocumentLoader, getRemoteDocument } from "./docloader.ts";
import { FetchError } from "./request.ts";
import { UrlError } from "./url.ts";

test("new FetchError()", () => {
  const e = new FetchError("https://example.com/", "An error message.");
  deepStrictEqual(e.name, "FetchError");
  deepStrictEqual(e.url, new URL("https://example.com/"));
  deepStrictEqual(e.message, "https://example.com/: An error message.");
  deepStrictEqual(e.response, undefined);

  const response = new Response(null, { status: 410 });
  const e2 = new FetchError(
    new URL("https://example.org/"),
    undefined,
    response,
  );
  deepStrictEqual(e2.url, new URL("https://example.org/"));
  deepStrictEqual(e2.message, "https://example.org/");
  ok(e2.response != null);
  deepStrictEqual(e2.response.status, 410);
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
      "Content-Type": "application/activity+json",
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

  fetchMock.get("https://example.com/html-no-alternate", {
    body: `<!DOCTYPE html>
      <html>
        <head>
          <title>Not an ActivityPub document</title>
        </head>
        <body>Not found</body>
      </html>`,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.test("HTML without ActivityPub alternate link", async () => {
    await rejects(
      () => fetchDocumentLoader("https://example.com/html-no-alternate"),
      (error) => {
        ok(error instanceof FetchError);
        ok(
          error.message.includes(
            "HTML document has no ActivityPub alternate link",
          ),
        );
        ok(
          error.message.includes("Content-Type: text/html; charset=utf-8"),
        );
        deepStrictEqual(
          error.url,
          new URL("https://example.com/html-no-alternate"),
        );
        ok(error.response != null);
        deepStrictEqual(
          error.response.headers.get("Content-Type"),
          "text/html; charset=utf-8",
        );
        return true;
      },
    );
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

  await t.test("wrong Content-Type with JSON body", async () => {
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

  fetchMock.get("https://example.com/large-html", {
    body: "<!DOCTYPE html>",
    headers: {
      "Content-Length": String(1024 * 1024 + 1),
      "Content-Type": "text/html; charset=utf-8",
    },
  });

  await t.test("HTML Content-Length over limit", async () => {
    await rejects(
      () => fetchDocumentLoader("https://example.com/large-html"),
      (error) => {
        ok(error instanceof FetchError);
        ok(
          error.message.includes(
            "HTML document is too large to scan for an ActivityPub alternate link",
          ),
        );
        ok(error.response != null);
        deepStrictEqual(error.response.status, 200);
        deepStrictEqual(
          error.response.headers.get("Content-Type"),
          "text/html; charset=utf-8",
        );
        return true;
      },
    );
  });

  await t.test("HTML Content-Length over limit cancels body", async () => {
    let canceled = false;
    const response = new Response("<!DOCTYPE html>", {
      headers: {
        "Content-Length": String(1024 * 1024 + 1),
        "Content-Type": "text/html; charset=utf-8",
      },
    });
    Object.defineProperty(response, "body", {
      value: {
        cancel: () => {
          canceled = true;
        },
      },
    });
    await rejects(
      () =>
        getRemoteDocument(
          "https://example.com/large-html-cancel",
          response,
          () => {
            throw new Error("unexpected alternate fetch");
          },
        ),
      FetchError,
    );
    deepStrictEqual(canceled, true);
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

  let redirectAttempts = 0;
  fetchMock.get("begin:https://example.com/too-many-redirects/", (cl) => {
    redirectAttempts++;
    const index = Number(cl.url.split("/").at(-1));
    return {
      status: 302,
      headers: {
        Location: `https://example.com/too-many-redirects/${index + 1}`,
      },
    };
  });

  await t.test("too many redirects", async () => {
    redirectAttempts = 0;
    await rejects(
      () => fetchDocumentLoader("https://example.com/too-many-redirects/0"),
      FetchError,
      "Too many redirections",
    );
    deepStrictEqual(redirectAttempts, 21);
  });

  await t.test("custom max redirection", async () => {
    redirectAttempts = 0;
    const loader = getDocumentLoader({ maxRedirection: 1 });
    await rejects(
      () => loader("https://example.com/too-many-redirects/0"),
      FetchError,
      "Too many redirections",
    );
    deepStrictEqual(redirectAttempts, 2);
  });

  let loopAttempts = 0;
  fetchMock.get("https://example.com/redirect-loop-a", () => {
    loopAttempts++;
    return {
      status: 302,
      headers: { Location: "https://example.com/redirect-loop-b" },
    };
  });
  fetchMock.get("https://example.com/redirect-loop-b", () => {
    loopAttempts++;
    return {
      status: 302,
      headers: { Location: "https://example.com/redirect-loop-a" },
    };
  });

  await t.test("redirect loop", async () => {
    loopAttempts = 0;
    await rejects(
      () => fetchDocumentLoader("https://example.com/redirect-loop-a"),
      FetchError,
      "Redirect loop detected",
    );
    deepStrictEqual(loopAttempts, 2);
  });

  let relativeLoopAttempts = 0;
  fetchMock.get("https://example.com/redirect-loop-relative", () => {
    relativeLoopAttempts++;
    return {
      status: 302,
      headers: { Location: "/redirect-loop-relative" },
    };
  });

  await t.test("redirect loop with relative location", async () => {
    relativeLoopAttempts = 0;
    await rejects(
      () => fetchDocumentLoader("https://example.com/redirect-loop-relative"),
      FetchError,
      "Redirect loop detected",
    );
    deepStrictEqual(relativeLoopAttempts, 1);
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
    // The malicious HTML will fail alternate discovery, but the important
    // thing is that it should complete quickly (not hang due to ReDoS).
    await rejects(
      () => fetchDocumentLoader("https://example.com/redos"),
      FetchError,
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
