import { configure, type LogRecord, reset } from "@logtape/logtape";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects } from "node:assert";
import type { LookupAddress } from "node:dns";
import { test } from "@fedify/fixture";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import preloadedContexts from "./contexts.ts";
import cidV1Context from "./contexts/cid-v1.json" with { type: "json" };
import {
  createDocumentLoader,
  getDocumentLoader,
  getRemoteDocument,
  type RemoteDocument,
} from "./docloader.ts";
import jsonld from "./jsonld.ts";
import type { ConnectionPinner } from "./pinners/mod.ts";
import { createPublicFetch, type PublicFetchSession } from "./public-fetch.ts";
import { FetchError } from "./request.ts";
import { UrlError } from "./url.ts";

// Validates addresses like openPublicFetch() but sends requests through the
// global fetch() without pinning, so that fetch-mock's hostname routes match
// on every runtime (the Bun pinner would substitute IP addresses).  The lookup
// is always injected, so tests do not depend on the network's DNS.
const unpinnedPublicFetch = createPublicFetch({
  pinner: () => Promise.resolve(null),
  lookup: () => Promise.reject(new Error("Unexpected default lookup")),
});

const PUBLIC_ADDRESS: LookupAddress = { address: "93.184.215.14", family: 4 };
const PRIVATE_ADDRESS: LookupAddress = { address: "10.0.0.1", family: 4 };

function lookupTestAddresses(
  hostname: string,
): Promise<readonly LookupAddress[]> {
  return Promise.resolve([
    hostname === "private.example" ? PRIVATE_ADDRESS : PUBLIC_ADDRESS,
  ]);
}

function openUnpinnedHop(url: string): Promise<PublicFetchSession> {
  return unpinnedPublicFetch.openPublicFetch(url, {
    lookup: lookupTestAddresses,
  });
}

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
  const fetchDocumentLoader = createDocumentLoader({}, {
    openHop: openUnpinnedHop,
  });

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

  fetchMock.get("https://example.com/private-redirect", {
    status: 302,
    headers: { Location: "https://private.example/object" },
  });

  fetchMock.get("https://private.example/object", {
    body: {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://private.example/object",
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
    await rejects(
      () => fetchDocumentLoader("https://private.example/object"),
      UrlError,
    );
    await rejects(
      () => fetchDocumentLoader("https://example.com/private-redirect"),
      UrlError,
    );
    deepStrictEqual(
      fetchMock.callHistory.calls("https://private.example/object").length,
      0,
    );
    // The default loader rejects these without resolving any hostname:
    const defaultLoader = getDocumentLoader();
    await rejects(() => defaultLoader("https://localhost/object"), UrlError);
    await rejects(() => defaultLoader("https://127.0.0.1/object"), UrlError);
    deepStrictEqual(
      fetchMock.callHistory.calls("https://localhost/object").length,
      0,
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
  for (const result of ["throws", "empty", "private", "default"] as const) {
    await t.step(result, async () => {
      const lookup = (): Promise<readonly LookupAddress[]> =>
        result === "throws"
          ? Promise.reject(new Error("Resolver unavailable"))
          : Promise.resolve(result === "empty" ? [] : [PRIVATE_ADDRESS]);
      // The default loader rejects IP literals without resolving them, so
      // the "default" step checks that its logging matches the injected one:
      const loader = result === "default"
        ? getDocumentLoader()
        : createDocumentLoader({}, {
          openHop: (url) =>
            unpinnedPublicFetch.openPublicFetch(url, { lookup }),
        });
      const records: LogRecord[] = [];
      await configure({
        sinks: {
          buffer: (record) => records.push(record),
        },
        loggers: [
          { category: "fedify", sinks: ["buffer"], lowestLevel: "debug" },
          { category: ["logtape", "meta"], sinks: [] },
        ],
        reset: true,
      });
      try {
        const url = result === "default"
          ? "https://10.0.0.1/object"
          : "https://dns-failure.invalid/object";
        let error: unknown;
        await rejects(() => loader(url), (e) => {
          error = e;
          return true;
        });
        ok(error instanceof UrlError);
        const disallowed = result === "private" || result === "default";
        deepStrictEqual(error.reason, disallowed ? "disallowed" : "dns");
        deepStrictEqual(
          records.map((r) => [r.level, r.rawMessage, r.properties.url]),
          [
            disallowed
              ? ["error", "Disallowed private URL: {url}", url]
              : ["debug", "DNS lookup failed for {url}", url],
          ],
        );
        ok(records[0].properties.error === error);
      } finally {
        await reset();
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

const unsupportedUrls = [
  "ftp://example.com/collection",
  "file:///collection",
  `data:application/ld+json,${
    encodeURIComponent(JSON.stringify({ id: "https://example.com/data" }))
  }`,
];

function isCredentialUrlError(error: unknown): boolean {
  return error instanceof UrlError && error.reason === "disallowed" &&
    error.message === "URLs with credentials are not allowed";
}

test("getDocumentLoader() rejects URLs with credentials", async (t) => {
  const start = "https://8.8.8.8/start";
  const target = "https://user:pass@8.8.8.8/document";
  for (const allowPrivateAddress of [false, true]) {
    const loader = getDocumentLoader({ allowPrivateAddress });
    for (const path of ["direct", "redirect", "Link", "HTML"]) {
      await t.step(
        `${path}, allowPrivateAddress=${allowPrivateAddress}`,
        async () => {
          await withFetchStub(
            (url) => {
              if (url !== start) return Response.json({});
              if (path === "redirect") return Response.redirect(target, 302);
              if (path === "HTML") {
                return new Response(
                  `<link rel="alternate" type="application/activity+json" href="${target}">`,
                  { headers: { "Content-Type": "text/html" } },
                );
              }
              return new Response("", {
                headers: {
                  "Content-Type": "text/plain",
                  Link:
                    `<${target}>; rel="alternate"; type="application/activity+json"`,
                },
              });
            },
            async (fetched) => {
              await rejects(
                loader(path === "direct" ? target : start),
                isCredentialUrlError,
              );
              deepStrictEqual(fetched, path === "direct" ? [] : [start]);
            },
          );
        },
      );
    }
    for (
      const url of [
        "https://user@8.8.8.8/document",
        "https://:pass@8.8.8.8/document",
        "https://%75ser:p%40ss@8.8.8.8/document",
        "http://user:pass@8.8.8.8/document",
      ]
    ) {
      await t.step(
        `${url}, allowPrivateAddress=${allowPrivateAddress}`,
        async () => {
          await withFetchStub(() => Response.json({}), async (fetched) => {
            await rejects(loader(url), isCredentialUrlError);
            deepStrictEqual(fetched, []);
          });
        },
      );
    }
    for (
      const url of [
        "https://:@8.8.8.8/document",
        "https://8.8.8.8/@user?q=@pass",
      ]
    ) {
      await t.step(
        `allows ${url}, allowPrivateAddress=${allowPrivateAddress}`,
        async () => {
          await withFetchStub(
            () => Response.json({ done: true }),
            async (fetched) => {
              const document = await loader(url);
              deepStrictEqual(document.document, { done: true });
              deepStrictEqual(fetched, [new URL(url).href]);
            },
          );
        },
      );
    }
  }
});

function isUnsupportedProtocolError(error: unknown, url: string): boolean {
  return error instanceof UrlError &&
    error.message === `Unsupported protocol: ${new URL(url).protocol}` &&
    error.reason === "disallowed";
}

async function withFetchStub(
  respond: (url: string) => Response,
  callback: (fetched: string[]) => Promise<void>,
): Promise<void> {
  const fetched: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push(url);
    return Promise.resolve(respond(url));
  };
  try {
    await callback(fetched);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const url of unsupportedUrls) {
  const scheme = new URL(url).protocol;

  test(`getDocumentLoader() rejects ${scheme} URLs with private addresses allowed before fetching`, async () => {
    await withFetchStub(() => Response.json({}), async (fetched) => {
      await rejects(
        getDocumentLoader({ allowPrivateAddress: true })(url),
        (e) => isUnsupportedProtocolError(e, url),
      );
      deepStrictEqual(fetched, []);
    });
  });

  test(`getDocumentLoader() rejects redirects to ${scheme} URLs with private addresses allowed`, async () => {
    const start = "https://example.com/redirect-to-unsupported";
    await withFetchStub(() => Response.redirect(url, 302), async (fetched) => {
      await rejects(
        getDocumentLoader({ allowPrivateAddress: true })(start),
        (e) => isUnsupportedProtocolError(e, url),
      );
      deepStrictEqual(fetched, [start]);
    });
  });

  for (const html of [false, true]) {
    test(
      `getDocumentLoader() rejects ${
        html ? "HTML" : "Link header"
      } alternates to ${scheme} URLs with private addresses allowed`,
      async () => {
        const start = "https://example.com/alternate-to-unsupported";
        await withFetchStub(
          () =>
            html
              ? new Response(
                `<link rel="alternate" type="application/activity+json" href="${url}">`,
                { headers: { "Content-Type": "text/html" } },
              )
              : new Response("", {
                headers: {
                  "Content-Type": "text/plain",
                  Link:
                    `<${url}>; rel="alternate"; type="application/activity+json"`,
                },
              }),
          async (fetched) => {
            await rejects(
              getDocumentLoader({ allowPrivateAddress: true })(start),
              (e) => isUnsupportedProtocolError(e, url),
            );
            deepStrictEqual(fetched, [start]);
          },
        );
      },
    );
  }
}

interface RecordedResponseInit {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** Whether cancelling the body fails. */
  readonly failCancel?: boolean;
  /** Whether cancelling the body never settles, like a tee branch's. */
  readonly hangCancel?: boolean;
  /** The `Response.url` to report, like an IP address URL on Bun. */
  readonly responseUrl?: string;
}

/**
 * Records the life cycle of fetch sessions and their responses as events:
 * `open <url>`, `fetch <url> #n`, `cancel #n`, `consumed #n`, and
 * `close <url>`.
 */
interface HopRecorder {
  readonly events: readonly string[];
  /** Makes a response whose body records being consumed or cancelled. */
  respond(url: string): Response;
  /** Records opening and closing the given session. */
  record(url: string, session: PublicFetchSession): PublicFetchSession;
  /** Opens a session that sends requests to {@link HopRecorder.respond}. */
  openHop(url: string): Promise<PublicFetchSession>;
  /**
   * Checks that every opened session is closed, and that every response is
   * consumed or cancelled before its session is closed.
   */
  assertInvariants(): void;
}

function createHopRecorder(
  responder: (url: string) => RecordedResponseInit,
): HopRecorder {
  const events: string[] = [];
  const states = new Map<Response, { readonly n: number; settled: boolean }>();
  const violations: string[] = [];
  let responses = 0;
  let opens = 0;
  let closes = 0;

  function respond(url: string): Response {
    const n = ++responses;
    events.push(`fetch ${url} #${n}`);
    const {
      status = 200,
      headers,
      body = "",
      failCancel,
      hangCancel,
      responseUrl,
    } = responder(url);
    const state = { n, settled: false };
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent && body !== "") {
          sent = true;
          controller.enqueue(new TextEncoder().encode(body));
          return;
        }
        controller.close();
        state.settled = true;
        events.push(`consumed #${n}`);
      },
      cancel() {
        state.settled = true;
        events.push(`cancel #${n}`);
        if (failCancel) throw new Error(`Failed to cancel #${n}`);
        if (hangCancel) return new Promise<void>(() => {});
      },
    }, { highWaterMark: 0 });
    const response = new Response(stream, { status, headers });
    if (responseUrl != null) {
      Object.defineProperty(response, "url", { value: responseUrl });
    }
    states.set(response, state);
    return response;
  }

  function record(
    url: string,
    session: PublicFetchSession,
  ): PublicFetchSession {
    opens++;
    events.push(`open ${url}`);
    const fetched: Response[] = [];
    let closed = false;
    return {
      get url() {
        return session.url;
      },
      async fetch(input, init) {
        const response = await session.fetch(input, init);
        fetched.push(response);
        return response;
      },
      async close() {
        if (closed) return;
        closed = true;
        for (const response of fetched) {
          const state = states.get(response);
          if (state != null && !state.settled) {
            violations.push(`#${state.n} is still open when closing ${url}`);
          }
        }
        closes++;
        events.push(`close ${url}`);
        await session.close();
      },
    };
  }

  function openHop(url: string): Promise<PublicFetchSession> {
    const origin = new URL(url).origin;
    return Promise.resolve(record(url, {
      url: new URL(url),
      fetch(input) {
        const target = input instanceof Request ? input.url : String(input);
        ok(new URL(target).origin === origin, `${target} is not on ${origin}`);
        return Promise.resolve(respond(target));
      },
      close: () => Promise.resolve(),
    }));
  }

  return {
    events,
    respond,
    record,
    openHop,
    assertInvariants() {
      deepStrictEqual(violations, []);
      deepStrictEqual(opens, closes);
    },
  };
}

const lifecycleDocument = {
  "@context": "https://www.w3.org/ns/activitystreams",
  id: "https://b.example/object",
  type: "Object",
};

test("getDocumentLoader() closes a redirect hop before the next hop", async () => {
  const recorder = createHopRecorder((url) =>
    url === "https://a.example/start"
      ? { status: 302, headers: { Location: "https://b.example/object" } }
      : { body: JSON.stringify(lifecycleDocument) }
  );
  const loader = createDocumentLoader({}, { openHop: recorder.openHop });
  deepStrictEqual(await loader("https://a.example/start"), {
    contextUrl: null,
    documentUrl: "https://b.example/object",
    document: lifecycleDocument,
  });
  deepStrictEqual(recorder.events, [
    "open https://a.example/start",
    "fetch https://a.example/start #1",
    "cancel #1",
    "close https://a.example/start",
    "open https://b.example/object",
    "fetch https://b.example/object #2",
    "consumed #2",
    "close https://b.example/object",
  ]);
  recorder.assertInvariants();
});

test("getDocumentLoader() cancels the body before a Link header alternate", async () => {
  const recorder = createHopRecorder((url) =>
    url === "https://a.example/start"
      ? {
        headers: {
          "Content-Type": "text/plain",
          Link: '<https://b.example/object>; rel="alternate"; ' +
            'type="application/activity+json"',
        },
        body: "not JSON",
      }
      : { body: JSON.stringify(lifecycleDocument) }
  );
  const loader = createDocumentLoader({}, { openHop: recorder.openHop });
  deepStrictEqual(
    (await loader("https://a.example/start")).documentUrl,
    "https://b.example/object",
  );
  deepStrictEqual(recorder.events, [
    "open https://a.example/start",
    "fetch https://a.example/start #1",
    "cancel #1",
    "close https://a.example/start",
    "open https://b.example/object",
    "fetch https://b.example/object #2",
    "consumed #2",
    "close https://b.example/object",
  ]);
  recorder.assertInvariants();
});

test("getDocumentLoader() reads the body before an HTML alternate", async () => {
  const recorder = createHopRecorder((url) =>
    url === "https://a.example/start"
      ? {
        headers: { "Content-Type": "text/html" },
        body: '<link rel="alternate" type="application/activity+json" ' +
          'href="https://b.example/object">',
      }
      : { body: JSON.stringify(lifecycleDocument) }
  );
  const loader = createDocumentLoader({}, { openHop: recorder.openHop });
  deepStrictEqual(
    (await loader("https://a.example/start")).documentUrl,
    "https://b.example/object",
  );
  deepStrictEqual(recorder.events, [
    "open https://a.example/start",
    "fetch https://a.example/start #1",
    "consumed #1",
    "close https://a.example/start",
    "open https://b.example/object",
    "fetch https://b.example/object #2",
    "consumed #2",
    "close https://b.example/object",
  ]);
  recorder.assertInvariants();
});

/**
 * Fails instead of blocking the test if the given promise does not settle
 * within the given time.
 */
async function settlesWithin<T>(
  promise: Promise<T>,
  milliseconds = 1000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not settle in ${milliseconds} ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the given function while capturing the document loader's logs, and
 * waits until the rejections of body cancellations started without being
 * awaited have been logged.
 */
async function captureDocumentLoaderLogs<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; records: LogRecord[] }> {
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      {
        category: ["fedify", "runtime", "docloader"],
        sinks: ["buffer"],
        lowestLevel: "debug",
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  try {
    const result = await fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { result, records };
  } finally {
    await reset();
  }
}

function cancelFailureLogs(
  records: readonly LogRecord[],
): [string, unknown, string][] {
  return records
    .filter((record) =>
      record.rawMessage ===
        "Failed to cancel the response body from {url}: {error}"
    )
    .map((record) => [
      record.level,
      record.properties.url,
      String(record.properties.error),
    ]);
}

function linkHeaderAlternate(next: string): RecordedResponseInit {
  return {
    headers: {
      "Content-Type": "text/plain",
      Link: `<${next}>; rel="alternate"; type="application/activity+json"`,
    },
    body: "not JSON",
  };
}

test("getDocumentLoader() continues if an intermediate body fails to cancel", async (t) => {
  for (const kind of ["redirect", "Link header alternate"] as const) {
    await t.step(kind, async () => {
      const recorder = createHopRecorder((url) =>
        url === "https://a.example/start"
          ? {
            ...(kind === "redirect"
              ? {
                status: 302,
                headers: { Location: "https://b.example/object" },
              }
              : linkHeaderAlternate("https://b.example/object")),
            failCancel: true,
          }
          : { body: JSON.stringify(lifecycleDocument) }
      );
      const loader = createDocumentLoader({}, { openHop: recorder.openHop });
      const { result, records } = await captureDocumentLoaderLogs(() =>
        loader("https://a.example/start")
      );
      deepStrictEqual(result, {
        contextUrl: null,
        documentUrl: "https://b.example/object",
        document: lifecycleDocument,
      });
      deepStrictEqual(recorder.events, [
        "open https://a.example/start",
        "fetch https://a.example/start #1",
        "cancel #1",
        "close https://a.example/start",
        "open https://b.example/object",
        "fetch https://b.example/object #2",
        "consumed #2",
        "close https://b.example/object",
      ]);
      recorder.assertInvariants();
      // The failure is only logged:
      deepStrictEqual(cancelFailureLogs(records), [[
        "debug",
        "https://a.example/start",
        "Error: Failed to cancel #1",
      ]]);
    });
  }
});

test("getDocumentLoader() does not wait for intermediate bodies to be cancelled", async (t) => {
  for (const kind of ["redirect", "Link header alternate"] as const) {
    await t.step(kind, async () => {
      const recorder = createHopRecorder((url) =>
        url === "https://a.example/start"
          ? {
            ...(kind === "redirect"
              ? {
                status: 302,
                headers: { Location: "https://b.example/object" },
              }
              : linkHeaderAlternate("https://b.example/object")),
            hangCancel: true,
          }
          : { body: JSON.stringify(lifecycleDocument) }
      );
      const loader = createDocumentLoader({}, { openHop: recorder.openHop });
      deepStrictEqual(
        (await settlesWithin(loader("https://a.example/start"))).documentUrl,
        "https://b.example/object",
      );
      deepStrictEqual(recorder.events, [
        "open https://a.example/start",
        "fetch https://a.example/start #1",
        "cancel #1",
        "close https://a.example/start",
        "open https://b.example/object",
        "fetch https://b.example/object #2",
        "consumed #2",
        "close https://b.example/object",
      ]);
      recorder.assertInvariants();
    });
  }

  await t.step("public session with a never-settling cancel", async () => {
    // A real session must not wait for a body it cancels on close() either:
    let cancelled = 0;
    const pinner: ConnectionPinner = {
      supports: () => true,
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              cancel() {
                cancelled++;
                return new Promise<void>(() => {});
              },
            }),
            { status: 404 },
          ),
        ),
      release() {},
    };
    const publicFetch = createPublicFetch({
      pinner: () => Promise.resolve(pinner),
      lookup: () => Promise.reject(new Error("Unexpected default lookup")),
    });
    const loader = createDocumentLoader({}, {
      openHop: (url) =>
        publicFetch.openPublicFetch(url, { lookup: lookupTestAddresses }),
    });
    await settlesWithin(
      rejects(loader("https://a.example/missing"), (error) => {
        ok(error instanceof FetchError);
        // The error retains a response clone for the caller.  Cancel that tee
        // branch too, so the underlying stream's cancellation can start.
        error.response?.body?.cancel().catch(() => {});
        return true;
      }),
    );
    deepStrictEqual(cancelled, 1);
  });
});

test("getDocumentLoader() completes with tee'd fetch-mock responses", async (t) => {
  // fetch-mock returns a clone (a tee branch) of a Response instance that a
  // route returns, and the cancellation of a tee branch settles only after
  // the other branch is cancelled too.  That never happens for a string body
  // on Node.js, and for a stream body on any runtime:
  const url = "https://example.com/teed";
  function stream(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  }
  const loaders = {
    unpinned: createDocumentLoader({}, { openHop: openUnpinnedHop }),
    "private addresses allowed": getDocumentLoader({
      allowPrivateAddress: true,
    }),
  };
  for (const [name, loader] of Object.entries(loaders)) {
    for (const body of ["string", "stream"] as const) {
      await t.step(`${name}: ${body} bodies`, async () => {
        const make = (text: string) => body === "string" ? text : stream(text);
        fetchMock.mockGlobal();
        try {
          fetchMock.get(
            `${url}/object`,
            () =>
              new Response(make(JSON.stringify(lifecycleDocument)), {
                headers: { "Content-Type": "application/activity+json" },
              }),
          );
          fetchMock.get(
            `${url}/redirect`,
            () =>
              new Response(make("redirect"), {
                status: 302,
                headers: { Location: `${url}/object` },
              }),
          );
          fetchMock.get(
            `${url}/alternate`,
            () =>
              new Response(make("not JSON"), {
                headers: {
                  "Content-Type": "text/plain",
                  Link: `<${url}/object>; rel="alternate"; ` +
                    'type="application/activity+json"',
                },
              }),
          );
          fetchMock.get(
            `${url}/missing`,
            () => new Response(make("not found"), { status: 404 }),
          );
          for (const path of ["redirect", "alternate"]) {
            deepStrictEqual(
              (await settlesWithin(loader(`${url}/${path}`))).document,
              lifecycleDocument,
            );
          }
          await settlesWithin(rejects(loader(`${url}/missing`), FetchError));
          deepStrictEqual(
            fetchMock.callHistory.calls().map((call) => call.url),
            [
              `${url}/redirect`,
              `${url}/object`,
              `${url}/alternate`,
              `${url}/object`,
              `${url}/missing`,
            ],
          );
        } finally {
          fetchMock.hardReset();
        }
      });
    }
  }
});

test("getDocumentLoader() resolves each hop once", async () => {
  const lookups: string[] = [];
  const recorder = createHopRecorder((url) => {
    // Pinned responses report the IP address URL on Bun; the request URL must
    // still be used as the document URL and as the base of Location:
    const responseUrl = `https://${PUBLIC_ADDRESS.address}${
      new URL(url).pathname
    }`;
    if (url === "https://a.example/start") {
      return {
        status: 302,
        headers: { Location: "https://b.example/next" },
        responseUrl,
      };
    } else if (url === "https://b.example/next") {
      return { status: 301, headers: { Location: "/object" }, responseUrl };
    }
    return { body: JSON.stringify(lifecycleDocument), responseUrl };
  });
  const pinner: ConnectionPinner = {
    supports: () => true,
    fetch: (_grant, request) => Promise.resolve(recorder.respond(request.url)),
    release() {},
  };
  const publicFetch = createPublicFetch({
    pinner: () => Promise.resolve(pinner),
    lookup: () => Promise.reject(new Error("Unexpected default lookup")),
  });
  const loader = createDocumentLoader({}, {
    openHop: async (url) =>
      recorder.record(
        url,
        await publicFetch.openPublicFetch(url, {
          lookup(hostname) {
            lookups.push(hostname);
            return Promise.resolve([PUBLIC_ADDRESS]);
          },
        }),
      ),
  });
  deepStrictEqual(await loader("https://a.example/start"), {
    contextUrl: null,
    documentUrl: "https://b.example/object",
    document: lifecycleDocument,
  });
  deepStrictEqual(lookups, ["a.example", "b.example", "b.example"]);
  deepStrictEqual(recorder.events, [
    "open https://a.example/start",
    "fetch https://a.example/start #1",
    "cancel #1",
    "close https://a.example/start",
    "open https://b.example/next",
    "fetch https://b.example/next #2",
    "cancel #2",
    "close https://b.example/next",
    "open https://b.example/object",
    "fetch https://b.example/object #3",
    "consumed #3",
    "close https://b.example/object",
  ]);
  recorder.assertInvariants();
});

test("getRemoteDocument() cancels the body before loading a Link header alternate", async () => {
  const recorder = createHopRecorder(() => ({
    headers: {
      "Content-Type": "text/html",
      Link: '<https://b.example/object>; rel="alternate"; ' +
        'type="application/activity+json"',
    },
    body: "<html></html>",
  }));
  const response = recorder.respond("https://a.example/start");
  const placeholder: RemoteDocument = {
    contextUrl: null,
    document: {},
    documentUrl: "https://b.example/object",
  };
  const alternates: string[] = [];
  const result = await getRemoteDocument(
    "https://a.example/start",
    response,
    (url) => {
      alternates.push(url);
      deepStrictEqual(recorder.events.at(-1), "cancel #1");
      ok(response.bodyUsed);
      return Promise.resolve(placeholder);
    },
  );
  ok(result === placeholder);
  deepStrictEqual(alternates, ["https://b.example/object"]);
  deepStrictEqual(recorder.events, [
    "fetch https://a.example/start #1",
    "cancel #1",
  ]);
});
