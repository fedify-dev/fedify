import { configure, type LogRecord, reset } from "@logtape/logtape";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects } from "node:assert";
import dns from "node:dns/promises";
import { test } from "@fedify/fixture";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import preloadedContexts from "./contexts.ts";
import cidV1Context from "./contexts/cid-v1.json" with { type: "json" };
import { getDocumentLoader, getRemoteDocument } from "./docloader.ts";
import jsonld from "./jsonld.ts";
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
      "Content-Type": "text/html; charset=utf-8",
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

  fetchMock.get("https://example.com/wrong-content-type", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://example.com/wrong-content-type",
      name: "Fetched object",
      type: "Object",
    },
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await t.step("Wrong Content-Type", async () => {
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

  await t.step("preloaded Mastodon attribution domains", async () => {
    const context = [
      "https://www.w3.org/ns/activitystreams",
      "http://joinmastodon.org/ns",
    ];
    const expanded = await jsonld.expand({
      "@context": context,
      id: "https://social.example/users/alice",
      type: "Person",
      attributionDomains: ["blog.example"],
    }, { documentLoader: fetchDocumentLoader });
    deepStrictEqual(expanded, [{
      "@id": "https://social.example/users/alice",
      "@type": ["https://www.w3.org/ns/activitystreams#Person"],
      "http://joinmastodon.org/ns#attributionDomains": [
        { "@value": "blog.example" },
      ],
    }]);
    const compacted = await jsonld.compact(expanded, context, {
      documentLoader: fetchDocumentLoader,
    });
    deepStrictEqual(compacted.attributionDomains, ["blog.example"]);
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

  // A Codeberg Pages outage must not prevent loading or expanding FEP-6757.
  // See: https://github.com/fedify-dev/fedify/issues/1211
  fetchMock.get("https://w3id.org/fep/6757", { status: 502 });
  await t.step("preloaded FEP-6757 context", async () => {
    const url = "https://w3id.org/fep/6757";
    deepStrictEqual(await fetchDocumentLoader(url), {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": {
          license: {
            "@id": "http://purl.org/dc/terms/license",
            "@type": "@id",
          },
          preferredLicense: {
            "@id": "https://w3id.org/fep/6757#preferredLicense",
            "@type": "@id",
          },
        },
      },
    });
    deepStrictEqual(
      await jsonld.expand({
        "@context": ["https://www.w3.org/ns/activitystreams", url],
        type: "Person",
        license: "https://creativecommons.org/licenses/by/4.0/",
        preferredLicense: "https://creativecommons.org/licenses/by-nc/4.0/",
      }, { documentLoader: fetchDocumentLoader }),
      [{
        "@type": ["https://www.w3.org/ns/activitystreams#Person"],
        "http://purl.org/dc/terms/license": [{
          "@id": "https://creativecommons.org/licenses/by/4.0/",
        }],
        "https://w3id.org/fep/6757#preferredLicense": [{
          "@id": "https://creativecommons.org/licenses/by-nc/4.0/",
        }],
      }],
    );
    deepStrictEqual(fetchMock.callHistory.calls(url).length, 0);
  });

  // A Codeberg Pages outage must not prevent expanding translation metadata.
  // See: https://github.com/fedify-dev/fedify/issues/1214
  fetchMock.get("https://w3id.org/fep/22cd", { status: 502 });
  await t.step("preloaded FEP-22cd context", async () => {
    const url = "https://w3id.org/fep/22cd";
    const articleId = "https://example.com/articles/1";
    const translatorId = "https://example.com/users/alice";
    const revisionId = "https://example.com/articles/1/revisions/1";
    deepStrictEqual(await fetchDocumentLoader(url), {
      contextUrl: null,
      documentUrl: url,
      document: {
        "@context": {
          "fep-22cd": "https://w3id.org/fep/22cd#",
          schema: "https://schema.org/",
          xsd: "http://www.w3.org/2001/XMLSchema#",
          translations: {
            "@id": "fep-22cd:translations",
            "@container": "@set",
          },
          Translation: "fep-22cd:Translation",
          sourceUpdated: {
            "@id": "fep-22cd:sourceUpdated",
            "@type": "xsd:dateTime",
          },
          translator: {
            "@id": "schema:translator",
            "@type": "@id",
            "@container": "@set",
          },
          inLanguage: "schema:inLanguage",
          translationOfWork: {
            "@id": "schema:translationOfWork",
            "@type": "@id",
          },
          isBasedOn: { "@id": "schema:isBasedOn", "@type": "@id" },
        },
      },
    });
    deepStrictEqual(
      await jsonld.expand({
        "@context": ["https://www.w3.org/ns/activitystreams", url],
        id: articleId,
        type: "Article",
        contentMap: { en: "Original", ko: "Translation" },
        translations: [{
          type: "Translation",
          inLanguage: "ko",
          translator: [translatorId],
          translationOfWork: articleId,
          sourceUpdated: "2026-09-01T00:00:00Z",
          isBasedOn: revisionId,
        }],
      }, { documentLoader: fetchDocumentLoader }),
      [{
        "@id": articleId,
        "@type": ["https://www.w3.org/ns/activitystreams#Article"],
        "https://www.w3.org/ns/activitystreams#content": [
          { "@language": "en", "@value": "Original" },
          { "@language": "ko", "@value": "Translation" },
        ],
        "https://w3id.org/fep/22cd#translations": [{
          "@type": ["https://w3id.org/fep/22cd#Translation"],
          "https://schema.org/inLanguage": [{ "@value": "ko" }],
          "https://schema.org/translator": [{ "@id": translatorId }],
          "https://schema.org/translationOfWork": [{ "@id": articleId }],
          "https://w3id.org/fep/22cd#sourceUpdated": [{
            "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
            "@value": "2026-09-01T00:00:00Z",
          }],
          "https://schema.org/isBasedOn": [{ "@id": revisionId }],
        }],
      }],
    );
    deepStrictEqual(fetchMock.callHistory.calls(url).length, 0);
    deepStrictEqual(
      fetchMock.callHistory.calls("https://www.w3.org/ns/activitystreams")
        .length,
      0,
    );
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
