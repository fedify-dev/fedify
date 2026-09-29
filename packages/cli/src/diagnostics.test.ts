import { test } from "@fedify/fixture";
import { Note } from "@fedify/vocab";
import {
  type DocumentLoader,
  FetchError,
  getDocumentLoader,
  UrlError,
} from "@fedify/vocab-runtime";
import {
  deepStrictEqual as assertEquals,
  ok,
  rejects as assertRejects,
  strictEqual as assertStrictEquals,
} from "node:assert/strict";

function assertStringIncludes(actual: string, expected: string) {
  ok(
    actual.includes(expected),
    `${JSON.stringify(actual)} does not include ${JSON.stringify(expected)}`,
  );
}
function assertInstanceOf<T>(
  actual: unknown,
  constructor: abstract new (...args: never[]) => T,
): asserts actual is T {
  ok(actual instanceof constructor);
}
import fetchMock from "fetch-mock";
import {
  createLookupDiagnostics,
  describeLookupFailure,
  lookupWithDiagnostics,
} from "./diagnostics.ts";

const url = "http://localhost/object";
const contextLoader = getDocumentLoader();
const remoteDocument = {
  contextUrl: null,
  documentUrl: url,
  document: {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Note",
    id: url,
    content: "Hello",
  },
};

test("describeLookupFailure only suggests signing object HTTP 401/403/404", () => {
  for (const status of [301, 400, 401, 403, 404, 410, 429, 500, 503]) {
    for (const source of ["object", "context", "other"] as const) {
      for (const signed of [false, true]) {
        const error = new FetchError(url, `HTTP ${status}: ${url}`);
        const result = describeLookupFailure({ error, source }, signed);
        assertStringIncludes(result.message, `HTTP ${status}`);
        const suggests = source === "object" && !signed &&
          [401, 403, 404].includes(status);
        assertEquals(result.suggestsAuthorizedFetch, suggests);
        assertEquals(result.message.includes("--authorized-fetch"), suggests);
      }
    }
  }
  const rawUrl = "HTTP://DNS.EXAMPLE:80";
  const http = describeLookupFailure({
    error: new FetchError(rawUrl, `HTTP 500: ${rawUrl}`),
    source: "object",
  }, false);
  assertStringIncludes(http.message, "HTTP 500");
  assertEquals(http.message.includes("Could not resolve"), false);
  for (
    const error of [
      new FetchError(url, "HTTP 404: something else"),
      new Error(`HTTP 404: ${url}`),
      new FetchError(`${url}?error=: HTTP 404: `, "parse failure"),
    ]
  ) {
    assertEquals(
      describeLookupFailure({ error, source: "object" }, false)
        .suggestsAuthorizedFetch,
      false,
    );
  }
});

test("describeLookupFailure recognizes DNS causes and preserves other errors", () => {
  for (
    const error of [
      new UrlError("DNS lookup failed", { reason: "dns" }),
      new TypeError("client error (Connect): dns error: name not known"),
      new TypeError(
        "failed to lookup address information: Name or service not known",
      ),
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
      }),
      Object.assign(new Error("getaddrinfo"), { code: "EAI_AGAIN" }),
    ]
  ) {
    const result = describeLookupFailure({ error, source: "object" }, false);
    assertEquals(
      result.message,
      "Could not resolve the host in the URL.  Check the URL and your network connection.",
    );
    assertEquals(result.suggestsAuthorizedFetch, false);
  }
  for (
    const error of [
      new TypeError("connection refused"),
      new TypeError("certificate verify failed"),
      new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }),
      new SyntaxError("Unexpected token"),
      new SyntaxError('Unexpected token d, "dns error" is not valid JSON'),
      new Error("JSON-LD error", {
        cause: new SyntaxError(
          'Unexpected token d, "dns error" is not valid JSON',
        ),
      }),
      new Error("Bad JSON from https://dns.example/object"),
    ]
  ) {
    const result = describeLookupFailure({ error, source: "object" }, false);
    assertStringIncludes(result.message, error.message);
    assertEquals(result.suggestsAuthorizedFetch, false);
  }
  const cyclic = new Error("cyclic");
  cyclic.cause = cyclic;
  assertEquals(
    describeLookupFailure({ error: cyclic, source: "object" }, false).message,
    "cyclic",
  );
  assertEquals(
    describeLookupFailure(undefined, false).suggestsAuthorizedFetch,
    false,
  );
});

test("describeLookupFailure escapes terminal controls from remote content", () => {
  for (
    const error of [
      new SyntaxError("Unexpected token \x1b]0;title\x07\x1b[8m"),
      new TypeError("fetch failed", { cause: new Error("\x9b2J") }),
      new FetchError(
        "http://localhost/\x1b",
        "HTTP 404: http://localhost/\x1b",
      ),
    ]
  ) {
    const description = describeLookupFailure(
      { error, source: "object" },
      false,
    );
    assertEquals(
      [...description.message].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code >= 127 && code <= 159;
      }),
      false,
    );
    assertStringIncludes(description.message, "\\x");
  }
});

test("lookup diagnostics forwards options, rethrows and clears recovered errors", async () => {
  const failure = new Error("failed");
  let fail = true;
  let receivedUrl: string | undefined;
  let receivedOptions: Parameters<DocumentLoader>[1];
  const loader: DocumentLoader = (url, options) => {
    receivedUrl = url;
    receivedOptions = options;
    if (fail) throw failure;
    return Promise.resolve(remoteDocument);
  };
  const diagnostics = createLookupDiagnostics(loader, loader);
  const options = { signal: new AbortController().signal };
  await assertRejects(() => diagnostics.documentLoader(url, options));
  assertStrictEquals(diagnostics.getObjectFailure()?.error, failure);
  await assertRejects(() => diagnostics.contextLoader(url, options));
  assertStrictEquals(diagnostics.getContextFailure()?.error, failure);
  assertStrictEquals(receivedOptions, options);
  assertEquals(receivedUrl, url);
  fail = false;
  await diagnostics.contextLoader(url, options);
  assertEquals(diagnostics.getContextFailure(), undefined);
  assertStrictEquals(diagnostics.getObjectFailure()?.error, failure);
  await diagnostics.documentLoader(url, options);
  assertEquals(diagnostics.getObjectFailure(), undefined);
});

test("lookupWithDiagnostics retains swallowed and wrapped failures per URL", async () => {
  const error = new FetchError(url, `HTTP 403: ${url}`);
  const failed = lookupWithDiagnostics(url, {
    documentLoader: () => Promise.reject(error),
    contextLoader,
  });
  const succeeded = lookupWithDiagnostics(url, {
    documentLoader: () => Promise.resolve(remoteDocument),
    contextLoader,
  });
  const [bad, good] = await Promise.all([failed, succeeded]);
  assertEquals(bad.object, null);
  assertStrictEquals(bad.failure?.error, error);
  assertEquals(bad.failure?.source, "object");
  assertInstanceOf(good.object, Note);
  assertEquals(good.failure, undefined);

  const contextError = new FetchError(url, `HTTP 404: ${url}`);
  const contextFailure = await lookupWithDiagnostics(url, {
    documentLoader: () => Promise.resolve(remoteDocument),
    contextLoader: () => Promise.reject(contextError),
  });
  assertEquals(contextFailure.object, null);
  assertStrictEquals(contextFailure.failure?.error, contextError);
  assertEquals(contextFailure.failure?.source, "context");
  assertEquals(
    describeLookupFailure(contextFailure.failure, false)
      .suggestsAuthorizedFetch,
    false,
  );
  ok(Object.isFrozen(good));
  const invalid = await lookupWithDiagnostics("not-a-url", {
    documentLoader: contextLoader,
    contextLoader,
  });
  assertEquals(invalid.object, null);
  assertInstanceOf(invalid.failure?.error, TypeError);
  assertEquals(invalid.failure?.source, "other");
});

test("lookupWithDiagnostics does not infer authorization from invalid JSON-LD", async () => {
  const result = await lookupWithDiagnostics(url, {
    documentLoader: () =>
      Promise.resolve({
        ...remoteDocument,
        document: { "@type": "https://example.com/Unknown" },
      }),
    contextLoader,
  });
  assertEquals(result.object, null);
  assertEquals(result.failure, undefined);
  assertEquals(
    describeLookupFailure(result.failure, false).suggestsAuthorizedFetch,
    false,
  );
});

test("lookupWithDiagnostics discards recovered failures and snapshots results", async () => {
  fetchMock.spyGlobal();
  fetchMock.get("begin:https://[2001:db8::1]/.well-known/webfinger", {
    links: [{
      rel: "self",
      type: "application/activity+json",
      href: "http://localhost/recovered",
    }],
  });
  const error = new FetchError(
    "https://[2001:db8::1]/object",
    "HTTP 403: https://[2001:db8::1]/object",
  );
  let failLater = false;
  try {
    const result = await lookupWithDiagnostics("https://[2001:db8::1]/object", {
      documentLoader: (requestedUrl) => {
        if (requestedUrl === "https://[2001:db8::1]/object" || failLater) {
          return Promise.reject(error);
        }
        return Promise.resolve({
          ...remoteDocument,
          document: {
            ...remoteDocument.document,
            icon: "http://localhost/icon",
          },
        });
      },
      contextLoader,
    });
    assertInstanceOf(result.object, Note);
    assertEquals(result.failure, undefined);
    failLater = true;
    await assertRejects(() => result.object!.getIcon());
    assertEquals(result.failure, undefined);
  } finally {
    fetchMock.unmockGlobal();
    fetchMock.removeRoutes();
  }
});

test("lookup diagnostics clears both failures between iterator steps", async () => {
  const error = new Error("suppressed page failure");
  const loader: DocumentLoader = () => Promise.reject(error);
  const recorder = createLookupDiagnostics(loader, loader);
  await assertRejects(() => recorder.documentLoader(url));
  await assertRejects(() => recorder.contextLoader(url));
  recorder.clearFailures();
  assertEquals(recorder.getObjectFailure(), undefined);
  assertEquals(recorder.getContextFailure(), undefined);
});

test("lookup diagnostics distinguishes blocked destinations from DNS failures", () => {
  const result = describeLookupFailure({
    error: new UrlError("Invalid or private address", { reason: "disallowed" }),
    source: "object",
  }, false);
  assertStringIncludes(result.message, "Invalid or private address");
  assertEquals(result.suggestsAuthorizedFetch, false);
});

test("lookup diagnostics retains swallowed, wrapped, and directly thrown timeouts", async () => {
  // Do not import the CLI module: it configures LogTape at import time.
  class TestTimeoutError extends Error {}
  const timeout = new TestTimeoutError("timed out");
  const object = await lookupWithDiagnostics(url, {
    documentLoader: () => Promise.reject(timeout),
    contextLoader,
  });
  assertEquals(object.object, null);
  assertStrictEquals(object.failure?.error, timeout);
  const context = await lookupWithDiagnostics(url, {
    documentLoader: () => Promise.resolve(remoteDocument),
    contextLoader: () => Promise.reject(timeout),
  });
  assertStrictEquals(context.failure?.error, timeout);
  ok(context.thrownError instanceof Error);
  const direct = await lookupWithDiagnostics(url, {
    documentLoader: contextLoader,
    contextLoader,
    tracerProvider: {
      getTracer() {
        throw timeout;
      },
    },
  });
  assertStrictEquals(direct.thrownError, timeout);
  assertStrictEquals(direct.failure?.error, timeout);
});
