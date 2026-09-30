import { configure, type LogRecord, reset } from "@logtape/logtape";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects, throws } from "node:assert";
import dns from "node:dns/promises";
import { test } from "@fedify/fixture";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { gzipSync } from "node:zlib";
import preloadedContexts from "./contexts.ts";
import cidV1Context from "./contexts/cid-v1.json" with { type: "json" };
import {
  getDocumentLoader,
  getRemoteDocument,
  resolveDocumentLoaderTimeout,
  withDocumentLoaderTimeout,
} from "./docloader.ts";
import { FetchError } from "./request.ts";
import { UrlError } from "./url.ts";

test("getRemoteDocument() forwards options to alternate documents", async () => {
  const records: LogRecord[] = [];
  await reset();
  await configure({
    sinks: { capture: (record) => records.push(record) },
    loggers: [{
      category: ["fedify"],
      lowestLevel: "debug",
      sinks: ["capture"],
    }],
  });
  try {
    for (const linkHeader of [true, false]) {
      for (const suppressError of [true, false, undefined]) {
        records.length = 0;
        const url = "https://example.com/alternate-source";
        const alternateUrl = "https://example.com/missing-alternate";
        const options = {
          suppressError,
          signal: new AbortController().signal,
        };
        const response = new Response(
          `<link rel="alternate" type="application/activity+json" href="${alternateUrl}">`,
          {
            headers: {
              "Content-Type": "text/html",
              ...(linkHeader
                ? {
                  Link:
                    `<${alternateUrl}>; rel="alternate"; type="application/activity+json"`,
                }
                : {}),
            },
          },
        );
        let alternateRequests = 0;
        await rejects(
          () =>
            getRemoteDocument(
              url,
              response,
              async (requestedUrl, forwarded) => {
                alternateRequests++;
                deepStrictEqual(requestedUrl, alternateUrl);
                deepStrictEqual(forwarded, options);
                return await getRemoteDocument(
                  requestedUrl,
                  new Response(null, { status: 404 }),
                  () => {
                    throw new Error("Unexpected additional alternate");
                  },
                  forwarded,
                );
              },
              options,
            ),
          FetchError,
        );
        deepStrictEqual(alternateRequests, 1);
        const failures = records.filter((record) =>
          record.rawMessage ===
            "Failed to fetch document: {status} {url} {headers}"
        );
        deepStrictEqual(failures.length, 1);
        deepStrictEqual(failures[0].level, suppressError ? "warning" : "error");
      }
    }
  } finally {
    await reset();
  }
});

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

  await t.step("ok", async () => {
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

  await t.step("Link header", async () => {
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

  await t.step("Link header relative url", async () => {
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

  await t.step("wrong Link header syntax", async () => {
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

  await t.step("HTML <link>", async () => {
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

  await t.step("XHTML <link>", async () => {
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

  await t.step("HTML <a>", async () => {
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

  await t.step("HTML without ActivityPub alternate link", async () => {
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

  await t.step("wrong Content-Type with JSON body", async () => {
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

  await t.step("HTML Content-Length over limit", async () => {
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

  await t.step("HTML Content-Length over limit cancels body", async () => {
    let canceled = false;
    const response = new Response("<!DOCTYPE html>", {
      headers: {
        "Content-Length": String(1024 * 1024 + 1),
        "Content-Type": "text/html; charset=utf-8",
      },
    });
    // The shared reader in body.ts cancels through a reader rather than the
    // body directly, so stub a real stream instead of a bare `cancel`.
    Object.defineProperty(response, "body", {
      value: new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true;
        },
      }),
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

  await t.step("not ok", async () => {
    await rejects(
      () => fetchDocumentLoader("https://example.com/404"),
      FetchError,
      "HTTP 404: https://example.com/404",
    );
  });

  await t.step("preloaded contexts", async () => {
    for (const [url, document] of Object.entries(preloadedContexts)) {
      deepStrictEqual(await fetchDocumentLoader(url), {
        contextUrl: null,
        documentUrl: url,
        document,
      });
    }
  });

  // Controlled Identifiers v1.0 requires JSON-LD processors to treat this
  // context URL as already resolved.  A temporary W3C outage must not prevent
  // an otherwise valid document from being processed.
  // See: https://www.w3.org/TR/cid-1.0/#json-ld-context
  //      https://github.com/fedify-dev/fedify/issues/932
  fetchMock.get("https://www.w3.org/ns/cid/v1", { status: 503 });
  await t.step("preloaded CID v1 context", async () => {
    const url = "https://www.w3.org/ns/cid/v1";
    deepStrictEqual(await fetchDocumentLoader(url), {
      contextUrl: null,
      documentUrl: url,
      document: cidV1Context,
    });
  });

  // The <https://w3id.org/fep/ef61> URL redirects to a Codeberg Pages host
  // which suffers recurring outages; while it is unreachable, expanding any
  // document referencing it fails before application handlers run.  It has to
  // be resolved from the built-in copy rather than over the network.
  // See: https://github.com/fedify-dev/fedify/issues/982
  await t.step("preloaded FEP-ef61 context", async () => {
    const url = "https://w3id.org/fep/ef61";
    ok(url in preloadedContexts);
    deepStrictEqual(await fetchDocumentLoader(url), {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": {
          gateways: {
            "@id": "https://w3id.org/fep/ef61/gateways",
            "@type": "@id",
            "@container": "@list",
          },
          digestMultibase:
            "https://www.w3.org/ns/credentials/v2#digestMultibase",
        },
      },
    });
  });

  // A Codeberg Pages outage must not prevent loading the FEP-7aa9 context.
  // See: https://github.com/fedify-dev/fedify/issues/1078
  fetchMock.get("https://w3id.org/fep/7aa9", { status: 502 });
  await t.step("preloaded FEP-7aa9 context", async () => {
    const url = "https://w3id.org/fep/7aa9";
    deepStrictEqual(await fetchDocumentLoader(url), {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": {
          "FeaturedCollection": "https://w3id.org/fep/7aa9#FeaturedCollection",
          "FeaturedItem": "https://w3id.org/fep/7aa9#FeaturedItem",
          "FeatureRequest": "https://w3id.org/fep/7aa9#FeatureRequest",
          "FeatureAuthorization":
            "https://w3id.org/fep/7aa9#FeatureAuthorization",
          "topic": {
            "@id": "https://w3id.org/fep/7aa9#topic",
            "@type": "@id",
          },
          "featuredObject": {
            "@id": "https://w3id.org/fep/7aa9#featuredObject",
            "@type": "@id",
          },
          "canFeature": {
            "@id": "https://w3id.org/fep/7aa9#canFeature",
            "@type": "@id",
          },
          "featureAuthorization": {
            "@id": "https://w3id.org/fep/7aa9#featureAuthorization",
            "@type": "@id",
          },
        },
      },
    });
    deepStrictEqual(fetchMock.callHistory.calls(url).length, 0);
  });

  await t.step("deny non-HTTP/HTTPS", async () => {
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

  await t.step("allowPrivateAddress: false", async () => {
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

  await t.step("allowPrivateAddress: true", async () => {
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

  await t.step("too many redirects", async () => {
    redirectAttempts = 0;
    await rejects(
      () => fetchDocumentLoader("https://example.com/too-many-redirects/0"),
      FetchError,
      "Too many redirections",
    );
    deepStrictEqual(redirectAttempts, 21);
  });

  await t.step("custom max redirection", async () => {
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

  await t.step("redirect loop", async () => {
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

  await t.step("redirect loop with relative location", async () => {
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

  await t.step("ReDoS resistance (CVE-2025-68475)", async () => {
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

test("getDocumentLoader() bounds JSON, HTML, and alternate documents", async () => {
  const url = "https://example.com/bounded";
  fetchMock.mockGlobal();
  let oversized = true;
  try {
    fetchMock.get(url, () =>
      new Response('{"name":"hello"}', {
        headers: {
          "Content-Type": "application/activity+json",
          ...(oversized
            ? { "Content-Length": String(16 * 1024 * 1024 + 1) }
            : {}),
        },
      }));
    const loader = getDocumentLoader({
      allowPrivateAddress: true,
    });
    await rejects(loader(url), FetchError);
    oversized = false;
    deepStrictEqual((await loader(url)).document, { name: "hello" });
    oversized = true;
    fetchMock.get(
      `${url}/html`,
      () =>
        new Response(" ".repeat(1024 * 1024 + 1), {
          headers: { "Content-Type": "text/html" },
        }),
    );
    await rejects(
      getDocumentLoader({ allowPrivateAddress: true })(`${url}/html`),
      FetchError,
    );
    fetchMock.get(`${url}/alternate`, () =>
      new Response("", {
        headers: {
          "Content-Type": "text/html",
          Link: `<${url}>; rel="alternate"; type="application/activity+json"`,
        },
      }));
    await rejects(loader(`${url}/alternate`), FetchError);
    fetchMock.get(`${url}/redirect`, {
      status: 302,
      headers: { Location: url },
    });
    await rejects(loader(`${url}/redirect`), FetchError);
  } finally {
    fetchMock.hardReset();
  }
});

test("getDocumentLoader() rejects oversized gzip responses from fetch", async () => {
  const document = { name: "a".repeat(16 * 1024 * 1024) };
  const compressed = gzipSync(JSON.stringify(document));
  ok(compressed.byteLength < 64 * 1024);
  const server = createServer((request, response) => {
    const body = request.url === "/small"
      ? gzipSync('{"name":"hello"}')
      : compressed;
    response.writeHead(200, {
      "Content-Type": "application/activity+json",
      "Content-Encoding": "gzip",
      "Content-Length": body.byteLength,
    });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    ok(address != null && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/document`;
    await rejects(
      getDocumentLoader({
        allowPrivateAddress: true,
      })(url),
      FetchError,
    );
    deepStrictEqual(
      (await getDocumentLoader({
        allowPrivateAddress: true,
      })(new URL("/small", url).href)).document,
      { name: "hello" },
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error == null ? resolve() : reject(error));
      server.closeAllConnections();
    });
  }
});

test("getRemoteDocument() bounds JSON by default", async () => {
  let canceled = false;
  let pulls = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(64 * 1024).fill(32));
      },
      cancel() {
        canceled = true;
      },
    }, { highWaterMark: 0 }),
  );
  await rejects(
    getRemoteDocument(
      "https://example.com/document",
      response,
      () => {
        throw new Error("Unexpected alternate document");
      },
    ),
    FetchError,
  );
  deepStrictEqual(canceled, true);
  deepStrictEqual(pulls, 257);
});

test("getDocumentLoader() logs DNS failures as such", async (t) => {
  // The validator skips DNS when Deno has no network permission.  Checked
  // here rather than with top-level await, which the CommonJS build rejects.
  if (
    "Deno" in globalThis &&
    (await Deno.permissions.query({ name: "net" })).state !== "granted"
  ) {
    throw new Error(
      "This DNS test requires Deno network permission (--allow-net).",
    );
  }
  const loader = getDocumentLoader();
  for (const result of ["throws", "empty", "private"] as const) {
    await t.step(result, async () => {
      // Stubbing works only because url.ts uses the default node:dns/promises
      // import; see the FIXME there.
      const originalLookup = dns.lookup;
      dns.lookup = (() =>
        result === "throws"
          ? Promise.reject(new Error("Resolver unavailable"))
          : Promise.resolve(
            result === "empty" ? [] : [{ address: "127.0.0.1", family: 4 }],
          )) as typeof dns.lookup;
      const records: LogRecord[] = [];
      await configure({
        sinks: {
          buffer: (record) =>
            records.push(record),
        },
        loggers: [
          { category: "fedify", sinks: ["buffer"], lowestLevel: "debug" },
          { category: ["logtape", "meta"], sinks: [] },
        ],
        reset: true,
      });
      try {
        const url = "https://dns-failure.invalid/object";
        let error: unknown;
        await rejects(() => loader(url), (e) => {
          error = e;
          return true;
        });
        ok(error instanceof UrlError);
        deepStrictEqual(
          error.reason,
          result === "private" ? "disallowed" : "dns",
        );
        deepStrictEqual(
          records.map((r) => [r.level, r.rawMessage, r.properties.url]),
          [
            result === "private"
              ? ["error", "Disallowed private URL: {url}", url]
              : ["debug", "DNS lookup failed for {url}", url],
          ],
        );
        ok(records[0].properties.error === error);
      } finally {
        await reset();
        dns.lookup = originalLookup;
      }
    });
  }
});

test("getDocumentLoader() bounds alternate document chains", async (t) => {
  const base = "https://example.com/alternate-chain/";
  const loader = getDocumentLoader({ allowPrivateAddress: true });
  for (const mode of ["header", "html", "mixed"] as const) {
    for (const hops of [20, 21]) {
      await t.step(`${mode}: ${hops} hops`, async () => {
        fetchMock.mockGlobal();
        let requests = 0;
        fetchMock.get(`begin:${base}`, ({ url }) => {
          requests++;
          const index = Number(new URL(url).pathname.split("/").at(-1));
          // Keep the unpatched regression bounded too.
          if (index === hops || requests > 30) {
            return Response.json({ done: true });
          }
          const next = `${base}${index + 1}`;
          if (mode === "mixed" && index % 2 === 1) {
            return Response.redirect(next, 302);
          }
          return alternate(next, mode === "html");
        });
        try {
          if (hops === 20) {
            deepStrictEqual((await loader(`${base}0`)).document, {
              done: true,
            });
          } else {
            await rejects(loader(`${base}0`), (error: unknown) => {
              ok(error instanceof FetchError);
              ok(error.message.includes("Too many redirections (21)"));
              return true;
            });
          }
          deepStrictEqual(requests, 21);
        } finally {
          fetchMock.hardReset();
        }
      });
    }
  }

  for (
    const mode of [
      "header",
      "html",
      "alternate-redirect",
      "redirect-alternate",
      "redirect-intermediate",
    ]
  ) {
    await t.step(`${mode}: cycle`, async () => {
      fetchMock.mockGlobal();
      let requests = 0;
      fetchMock.get(`begin:${base}`, ({ url }) => {
        requests++;
        if (requests > 30) return Response.json({ stopped: true });
        const index = Number(new URL(url).pathname.split("/").at(-1));
        const next = `${base}${
          mode === "redirect-intermediate"
            ? (index === 0 ? 1 : index === 1 ? 2 : 1)
            : 1 - index
        }`;
        if (
          (mode === "alternate-redirect" && index === 1) ||
          ((mode === "redirect-alternate" ||
            mode === "redirect-intermediate") && index === 0)
        ) {
          return Response.redirect(next, 302);
        }
        return alternate(next, mode === "html");
      });
      try {
        await rejects(loader(`${base}0`), (error: unknown) => {
          ok(error instanceof FetchError);
          ok(error.message.includes("Redirect loop detected:"));
          return true;
        });
        deepStrictEqual(requests, mode === "redirect-intermediate" ? 3 : 2);
      } finally {
        fetchMock.hardReset();
      }
    });
  }

  await t.step(
    "alternate followed by 20 redirects shares the limit",
    async () => {
      fetchMock.mockGlobal();
      let requests = 0;
      fetchMock.get(`begin:${base}`, ({ url }) => {
        requests++;
        const index = Number(new URL(url).pathname.split("/").at(-1));
        if (index === 21) return Response.json({ done: true });
        return index === 0
          ? alternate(`${base}1`, false)
          : Response.redirect(`${base}${index + 1}`, 302);
      });
      try {
        await rejects(loader(`${base}0`), (error: unknown) => {
          ok(error instanceof FetchError);
          ok(error.message.includes("Too many redirections (21)"));
          return true;
        });
        deepStrictEqual(requests, 21);
      } finally {
        fetchMock.hardReset();
      }
    },
  );

  await t.step(
    "relative alternate after redirect and isolated calls",
    async () => {
      fetchMock.mockGlobal();
      fetchMock.get(`${base}start`, Response.redirect(`${base}html`, 302));
      fetchMock.get(`${base}html`, alternate("./document", true));
      fetchMock.get(`${base}document`, Response.json({ done: true }));
      try {
        for (let i = 0; i < 2; i++) {
          const results = await Promise.all([
            loader(`${base}start`),
            loader(`${base}start`),
          ]);
          for (const result of results) {
            deepStrictEqual(result.document, { done: true });
            deepStrictEqual(result.documentUrl, `${base}document`);
          }
        }
      } finally {
        fetchMock.hardReset();
      }
    },
  );

  function alternate(next: string, html: boolean): Response {
    return html
      ? new Response(
        `<link rel="alternate" type="application/activity+json" href="${next}">`,
        {
          headers: { "Content-Type": "text/html" },
        },
      )
      : new Response("not JSON", {
        headers: {
          "Content-Type": "text/plain",
          Link: `<${next}>; rel="alternate"; type="application/activity+json"`,
        },
      });
  }
});

test("getDocumentLoader() preserves cancellation across alternates", async (t) => {
  const base = "https://example.com/alternate-abort/";
  const loader = getDocumentLoader({ allowPrivateAddress: true });
  for (const html of [false, true]) {
    await t.step(html ? "HTML" : "Link header", async () => {
      fetchMock.mockGlobal();
      const controller = new AbortController();
      let requests = 0;
      fetchMock.get(`begin:${base}`, ({ url }) => {
        requests++;
        const index = Number(new URL(url).pathname.split("/").at(-1));
        if (index === 2) return Response.json({ done: true });
        if (index === 1) controller.abort();
        const next = `${base}${index + 1}`;
        return new Response(
          html
            ? `<link rel="alternate" type="application/activity+json" href="${next}">`
            : "not JSON",
          {
            headers: html ? { "Content-Type": "text/html" } : {
              "Content-Type": "text/plain",
              Link:
                `<${next}>; rel="alternate"; type="application/activity+json"`,
            },
          },
        );
      });
      try {
        await rejects(loader(`${base}0`, { signal: controller.signal }), {
          name: "AbortError",
        });
        deepStrictEqual(requests, 2);
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("getDocumentLoader() rejects cancellation before fetching", async () => {
  fetchMock.mockGlobal();
  let requests = 0;
  const url = "https://example.com/pre-aborted-alternate";
  fetchMock.get(url, () => {
    requests++;
    return Response.json({ done: true });
  });
  try {
    const loader = getDocumentLoader({ allowPrivateAddress: true });
    const controller = new AbortController();
    controller.abort();
    await rejects(loader(url, { signal: controller.signal }), {
      name: "AbortError",
    });
    deepStrictEqual(requests, 0);
  } finally {
    fetchMock.hardReset();
  }
});

async function withServer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  callback: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    ok(address != null && typeof address !== "string");
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error == null ? resolve() : reject(error));
      server.closeAllConnections();
    });
  }
}

function isTimeoutFetchError(error: unknown, url: string): boolean {
  ok(error instanceof FetchError, String(error));
  deepStrictEqual(error.url.href, url);
  deepStrictEqual(error.response, undefined);
  ok(error.cause instanceof DOMException);
  deepStrictEqual(error.cause.name, "TimeoutError");
  return true;
}

test("resolveDocumentLoaderTimeout() validates timeouts", () => {
  deepStrictEqual(resolveDocumentLoaderTimeout(undefined), 10_000);
  deepStrictEqual(resolveDocumentLoaderTimeout(null), null);
  deepStrictEqual(resolveDocumentLoaderTimeout(1500), 1500);
  deepStrictEqual(resolveDocumentLoaderTimeout(0.5), 1);
  deepStrictEqual(resolveDocumentLoaderTimeout(2_147_483_647), 2_147_483_647);
  for (const invalid of [0, -1, NaN, Infinity, 2_147_483_648]) {
    throws(() => resolveDocumentLoaderTimeout(invalid), RangeError);
  }
  throws(() => getDocumentLoader({ timeout: 0 }), RangeError);
});

test("getDocumentLoader() times out a request without a response", async () => {
  await withServer(() => {
    // Never respond.
  }, async (baseUrl) => {
    const url = `${baseUrl}/hang`;
    const loader = getDocumentLoader({
      allowPrivateAddress: true,
      timeout: 100,
    });
    await rejects(loader(url), (e) => isTimeoutFetchError(e, url));
  });
});

test("getDocumentLoader() times out a stalled response body", async () => {
  for (const status of [200, 404]) {
    await withServer((_, response) => {
      response.writeHead(status, {
        "Content-Type": "application/activity+json",
      });
      response.write('{"id":');
      // Never finish the body.
    }, async (baseUrl) => {
      const url = `${baseUrl}/stalled`;
      const loader = getDocumentLoader({
        allowPrivateAddress: true,
        timeout: 200,
      });
      await rejects(loader(url), (e) => isTimeoutFetchError(e, url));
    });
  }
});

test("getDocumentLoader() shares the timeout across redirects", async () => {
  let requests = 0;
  await withServer((request, response) => {
    requests++;
    const index = Number(request.url?.split("/").at(-1));
    setTimeout(() => {
      if (index >= 15) {
        response.writeHead(200, {
          "Content-Type": "application/activity+json",
        });
        response.end('{"done":true}');
        return;
      }
      response.writeHead(302, { Location: `/redirect/${index + 1}` });
      response.end();
    }, 50);
  }, async (baseUrl) => {
    const url = `${baseUrl}/redirect/0`;
    // Each hop is well within the timeout, but the whole chain is not:
    const loader = getDocumentLoader({
      allowPrivateAddress: true,
      timeout: 300,
    });
    await rejects(loader(url), (e) => isTimeoutFetchError(e, url));
    ok(requests < 16, `requests: ${requests}`);
    // Without a timeout, the chain completes:
    const unbounded = getDocumentLoader({
      allowPrivateAddress: true,
      timeout: null,
    });
    deepStrictEqual((await unbounded(url)).document, { done: true });
  });
});

test("getDocumentLoader() shares the timeout across alternates", async (t) => {
  for (const html of [false, true]) {
    await t.step(html ? "HTML" : "Link header", async () => {
      await withServer((request, response) => {
        const index = Number(request.url?.split("/").at(-1));
        setTimeout(() => {
          if (index >= 15) {
            response.writeHead(200, {
              "Content-Type": "application/activity+json",
            });
            response.end('{"done":true}');
            return;
          }
          const next = `/alternate/${index + 1}`;
          response.writeHead(
            200,
            html ? { "Content-Type": "text/html" } : {
              "Content-Type": "text/plain",
              Link:
                `<${next}>; rel="alternate"; type="application/activity+json"`,
            },
          );
          response.end(
            html
              ? `<link rel="alternate" type="application/activity+json" href="${next}">`
              : "not JSON",
          );
        }, 50);
      }, async (baseUrl) => {
        const url = `${baseUrl}/alternate/0`;
        const loader = getDocumentLoader({
          allowPrivateAddress: true,
          timeout: 300,
        });
        await rejects(loader(url), (e) => isTimeoutFetchError(e, url));
      });
    });
  }
});

test("getDocumentLoader() lets the caller's signal abort a request", async () => {
  await withServer(() => {
    // Never respond.
  }, async (baseUrl) => {
    const url = `${baseUrl}/hang`;
    for (const timeout of [undefined, 60_000, null]) {
      const loader = getDocumentLoader({ allowPrivateAddress: true, timeout });
      const controller = new AbortController();
      const reason = new Error("Canceled by the caller");
      setTimeout(() => controller.abort(reason), 50);
      await rejects(loader(url, { signal: controller.signal }), (e) => {
        deepStrictEqual(e, reason);
        return true;
      });
    }
    // The caller's signal wins even if the timeout fires too:
    const loader = getDocumentLoader({
      allowPrivateAddress: true,
      timeout: 50,
    });
    const controller = new AbortController();
    const reason = new Error("Canceled by the caller");
    controller.abort(reason);
    await rejects(loader(url, { signal: controller.signal }), (e) => {
      deepStrictEqual(e, reason);
      return true;
    });
  });
});

test("getDocumentLoader() bounds DNS lookups that ignore the timeout", async () => {
  // The validator skips DNS when Deno has no network permission.
  if (
    "Deno" in globalThis &&
    (await Deno.permissions.query({ name: "net" })).state !== "granted"
  ) {
    throw new Error(
      "This DNS test requires Deno network permission (--allow-net).",
    );
  }
  fetchMock.mockGlobal();
  let requests = 0;
  const url = "https://slow-dns.example/object";
  fetchMock.get(url, () => {
    requests++;
    return Response.json({ id: url });
  });
  // Stubbing works only because url.ts uses the default node:dns/promises
  // import; see the FIXME there.
  const originalLookup = dns.lookup;
  let resolveLookup: () => void = () => {};
  const lookedUp = new Promise<void>((resolve) => resolveLookup = resolve);
  dns.lookup = (() =>
    new Promise((resolve) =>
      setTimeout(() => {
        resolve([{ address: "93.184.215.14", family: 4 }]);
        resolveLookup();
      }, 200)
    )) as typeof dns.lookup;
  try {
    const loader = getDocumentLoader({ timeout: 50 });
    await rejects(loader(url), (e) => isTimeoutFetchError(e, url));
    // A late DNS answer must not start the request anymore:
    await lookedUp;
    await new Promise((resolve) => setTimeout(resolve, 10));
    deepStrictEqual(requests, 0);
  } finally {
    dns.lookup = originalLookup;
    fetchMock.hardReset();
  }
});

test("withDocumentLoaderTimeout() cleans up after each call", async () => {
  const signals: AbortSignal[] = [];
  const loader = withDocumentLoaderTimeout((url, options) => {
    signals.push(options!.signal!);
    return Promise.resolve({
      contextUrl: null,
      document: {},
      documentUrl: url,
    });
  }, 50);
  const results = await Promise.all([
    loader("https://example.com/a"),
    loader("https://example.com/b"),
  ]);
  deepStrictEqual(results.map((r) => r.documentUrl), [
    "https://example.com/a",
    "https://example.com/b",
  ]);
  ok(signals[0] !== signals[1]);
  // The timers are cleared, so the signals are never aborted:
  await new Promise((resolve) => setTimeout(resolve, 100));
  ok(signals.every((signal) => !signal.aborted));
  // A loader that is given no timeout is returned as is:
  const inner = () => Promise.reject(new Error("unused"));
  ok(withDocumentLoaderTimeout(inner, null) === inner);
});

test("getRemoteDocument() keeps error bodies byte for byte", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x4e, 0x6f, 0xff, 0xfe]);
  const url = "https://example.com/error";
  let error: unknown;
  await rejects(
    getRemoteDocument(
      url,
      new Response(bytes, { status: 404 }),
      () => Promise.reject(new Error("unused")),
    ),
    (e) => {
      error = e;
      return true;
    },
  );
  ok(error instanceof FetchError);
  ok(error.response != null);
  deepStrictEqual(error.response.status, 404);
  deepStrictEqual(new Uint8Array(await error.response.arrayBuffer()), bytes);
});

test("getRemoteDocument() keeps metadata of bodiless or large errors", async () => {
  const url = "https://example.com/error";
  for (
    const response of [
      new Response(null, { status: 304, headers: { ETag: '"a"' } }),
      new Response(new Uint8Array(1024 * 1024 + 1), {
        status: 500,
        headers: { ETag: '"a"' },
      }),
    ]
  ) {
    await rejects(
      getRemoteDocument(
        url,
        response,
        () => Promise.reject(new Error("unused")),
      ),
      (e) => {
        ok(e instanceof FetchError);
        ok(e.response != null);
        deepStrictEqual(e.response.status, response.status);
        deepStrictEqual(e.response.headers.get("ETag"), '"a"');
        deepStrictEqual(e.response.body, null);
        return true;
      },
    );
  }
});

test("getDocumentLoader() reports statuses that Response cannot hold", async () => {
  await withServer((_, response) => {
    response.writeHead(999);
    response.end("Request denied");
  }, async (baseUrl) => {
    const url = `${baseUrl}/denied`;
    const loader = getDocumentLoader({ allowPrivateAddress: true });
    let error: unknown;
    await rejects(loader(url), (e) => {
      error = e;
      return true;
    });
    ok(error instanceof FetchError, String(error));
    deepStrictEqual(error.response?.status, 999);
    deepStrictEqual(await error.response.text(), "Request denied");
  });
});

test("getDocumentLoader() times out a stalled body of such a status", async () => {
  await withServer((_, response) => {
    response.writeHead(999);
    response.write("Request");
    // Never finish the body.
  }, async (baseUrl) => {
    const url = `${baseUrl}/stalled-denied`;
    const loader = getDocumentLoader({
      allowPrivateAddress: true,
      timeout: 200,
    });
    await rejects(loader(url), (e) => isTimeoutFetchError(e, url));
  });
});
