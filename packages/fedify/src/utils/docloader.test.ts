import { mockDocumentLoader, test } from "@fedify/fixture";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { assertEquals, assertRejects } from "@std/assert";
import fetchMock from "fetch-mock";
import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import { verifyRequest } from "../sig/http.ts";
import { rsaPrivateKey2 } from "../testing/keys.ts";
import {
  createAuthenticatedDocumentLoader,
  getAuthenticatedDocumentLoader,
} from "./docloader.ts";

const identity = {
  keyId: new URL("https://example.com/key2"),
  privateKey: rsaPrivateKey2,
};

// Loads without address validation, so that requests reach fetch-mock with
// their hostnames on every runtime (Bun pins validated hostnames to IPs):
const directDeps = { openHop: openDirectFetch };

// Applies the public address policy with the given lookup, and then fetches
// without pinning, so that requests reach fetch-mock with their hostnames:
function publicPolicyHop(
  lookup: (hostname: string) => Promise<{ address: string; family: number }[]>,
): (url: string) => Promise<PublicFetchSession> {
  return async (url) => {
    const session = await openPublicFetch(url, { lookup });
    await session.close();
    return openDirectFetch(url);
  };
}

const publicLookup = () => Promise.resolve([{ address: "8.8.8.8", family: 4 }]);

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
    const loader = createAuthenticatedDocumentLoader(identity, {}, directDeps);
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

  const policyDeps = { openHop: publicPolicyHop(publicLookup) };

  await t.step("deny public-to-private redirects", async () => {
    const loader = createAuthenticatedDocumentLoader(identity, {}, policyDeps);
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
    const loader = createAuthenticatedDocumentLoader(identity, {}, policyDeps);
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

test("getAuthenticatedDocumentLoader() cancellation", async (t) => {
  fetchMock.spyGlobal();
  try {
    await t.step("document loader cancellation", async () => {
      let responseTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        fetchMock.get(
          "https://example.com/slow-object",
          () =>
            new Promise((resolve) => {
              responseTimer = setTimeout(() => {
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

        const loader = createAuthenticatedDocumentLoader(
          identity,
          {},
          directDeps,
        );

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
          () =>
            loader("https://example.com/object", { signal: controller.signal }),
          Error,
        );
      } finally {
        clearTimeout(responseTimer);
      }
    });

    await t.step("immediate cancellation", async () => {
      const loader = createAuthenticatedDocumentLoader(
        identity,
        {},
        directDeps,
      );

      const controller = new AbortController();
      controller.abort();

      await assertRejects(
        () =>
          loader("https://example.com/object", { signal: controller.signal }),
        Error,
      );
    });
  } finally {
    fetchMock.hardReset();
  }
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

test("getAuthenticatedDocumentLoader() logs DNS failures as such", async (t) => {
  for (const result of ["throws", "empty", "private"] as const) {
    await t.step(result, async () => {
      const lookup = () =>
        result === "throws"
          ? Promise.reject(new Error("Resolver unavailable"))
          : Promise.resolve(
            result === "empty" ? [] : [{ address: "127.0.0.1", family: 4 }],
          );
      const loader = createAuthenticatedDocumentLoader(identity, {}, {
        openHop: (url) => openPublicFetch(url, { lookup }),
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
        const url = "https://dns-failure.invalid/object";
        const error = await assertRejects(() => loader(url), UrlError);
        assertEquals(error.reason, result === "private" ? "disallowed" : "dns");
        assertEquals(
          records.map((r) => [r.level, r.rawMessage, r.properties.url]),
          [
            result === "private"
              ? ["error", "Disallowed private URL: {url}", url]
              : ["debug", "DNS lookup failed for {url}", url],
          ],
        );
        assertEquals(records[0].properties.error, error);
      } finally {
        await reset();
      }
    });
  }
});

test("getAuthenticatedDocumentLoader() bounds alternate document chains", async (t) => {
  const base = "https://example.com/alternate-chain/";
  const loader = getAuthenticatedDocumentLoader({
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  }, { allowPrivateAddress: true });
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

test("getAuthenticatedDocumentLoader() preserves cancellation across alternates", async (t) => {
  const base = "https://example.com/alternate-abort/";
  const loader = getAuthenticatedDocumentLoader({
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  }, { allowPrivateAddress: true });
  for (const html of [false, true]) {
    await t.step(html ? "HTML" : "Link header", async () => {
      fetchMock.mockGlobal();
      const controller = new AbortController();
      const reason = new Error("Alternate document loading cancelled");
      let requests = 0;
      fetchMock.get(`begin:${base}`, ({ url }) => {
        requests++;
        const index = Number(new URL(url).pathname.split("/").at(-1));
        if (index === 2) return Response.json({ done: true });
        if (index === 1) controller.abort(reason);
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
        await rejects(
          loader(`${base}0`, { signal: controller.signal }),
          (error: unknown) => {
            ok(error === reason);
            return true;
          },
        );
        deepStrictEqual(requests, 2);
      } finally {
        fetchMock.hardReset();
      }
    });
  }
});

test("getAuthenticatedDocumentLoader() tracks fallback redirects after alternates", async () => {
  fetchMock.mockGlobal();
  let requests = 0;
  let knocks = 0;
  const first = "https://example.com/fallback-alternate/a";
  const second = "https://example.com/fallback-alternate/b";
  fetchMock.get(first, () => {
    requests++;
    if (requests > 30) return Response.json({ stopped: true });
    return new Response("", {
      headers: {
        "Content-Type": "text/plain",
        Link: `<${second}>; rel="alternate"; type="application/activity+json"`,
      },
    });
  });
  fetchMock.get(second, () => {
    requests++;
    return ++knocks % 2 === 1
      ? new Response("", { status: 401 })
      : Response.redirect(first, 302);
  });
  try {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    }, { allowPrivateAddress: true });
    await assertRejects(
      () => loader(first),
      FetchError,
      "Redirect loop detected:",
    );
    assertEquals(requests, 3);
  } finally {
    fetchMock.hardReset();
  }
});

test("getAuthenticatedDocumentLoader() resolves relative alternates without response URLs", async () => {
  const originalFetch = globalThis.fetch;
  const base = "https://example.com/empty-response-url/";
  const urls: string[] = [];
  globalThis.fetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    if (url === `${base}start`) {
      return Promise.resolve(Response.redirect(`${base}nested/page`, 302));
    }
    if (url === `${base}nested/page`) {
      return Promise.resolve(
        new Response(
          '<link rel="alternate" type="application/activity+json" href="document">',
          { headers: { "Content-Type": "text/html" } },
        ),
      );
    }
    assertEquals(url, `${base}nested/document`);
    return Promise.resolve(Response.json({ done: true }));
  };
  try {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    }, { allowPrivateAddress: true });
    assertEquals(await loader(`${base}start`), {
      contextUrl: null,
      document: { done: true },
      documentUrl: `${base}nested/document`,
    });
    assertEquals(urls, [
      `${base}start`,
      `${base}nested/page`,
      `${base}nested/document`,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAuthenticatedDocumentLoader() validates alternate addresses", async () => {
  fetchMock.mockGlobal();
  let privateRequests = 0;
  const url = "https://8.8.8.8/alternate";
  fetchMock.get(
    url,
    new Response("", {
      headers: {
        "Content-Type": "text/plain",
        Link:
          '<http://127.0.0.1/private>; rel="alternate"; type="application/activity+json"',
      },
    }),
  );
  fetchMock.get("http://127.0.0.1/private", () => {
    privateRequests++;
    return Response.json({ private: true });
  });
  try {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    });
    await assertRejects(() => loader(url), UrlError);
    assertEquals(privateRequests, 0);
  } finally {
    fetchMock.hardReset();
  }
});

test("getAuthenticatedDocumentLoader() rejects cancellation before fetching", async () => {
  fetchMock.mockGlobal();
  let requests = 0;
  const url = "https://example.com/pre-aborted-alternate";
  fetchMock.get(url, () => {
    requests++;
    return Response.json({ done: true });
  });
  try {
    const loader = getAuthenticatedDocumentLoader({
      keyId: new URL("https://example.com/key2"),
      privateKey: rsaPrivateKey2,
    }, { allowPrivateAddress: true });
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

test("getAuthenticatedDocumentLoader() closes each hop before opening the next", async (t) => {
  await t.step("redirect", async () => {
    const start = "https://example.com/lifecycle/start";
    const next = "https://example.com/lifecycle/document";
    const hops = recordHops((request): RecordedResponseInit =>
      request.url === start
        ? { status: 302, headers: { Location: next }, body: "Found" }
        : {
          headers: { "Content-Type": "application/activity+json" },
          body: '{"done":true}',
        }
    );
    const loader = createAuthenticatedDocumentLoader(identity, {}, hops);
    deepStrictEqual(await loader(start), {
      contextUrl: null,
      document: { done: true },
      documentUrl: next,
    });
    deepStrictEqual(hops.events, [
      `open ${start}`,
      `fetch #1 ${start}`,
      "cancel #1",
      `close ${start}`,
      `open ${next}`,
      `fetch #2 ${next}`,
      "consumed #2",
      `close ${next}`,
    ]);
    hops.assertInvariants();
  });

  await t.step("Link header alternate", async () => {
    const start = "https://example.com/lifecycle/page";
    const next = "https://example.com/lifecycle/alternate";
    const hops = recordHops((request): RecordedResponseInit =>
      request.url === start
        ? {
          headers: {
            "Content-Type": "text/plain",
            Link:
              `<${next}>; rel="alternate"; type="application/activity+json"`,
          },
          body: "not JSON",
        }
        : {
          headers: { "Content-Type": "application/activity+json" },
          body: '{"done":true}',
        }
    );
    const loader = createAuthenticatedDocumentLoader(identity, {}, hops);
    deepStrictEqual((await loader(start)).document, { done: true });
    deepStrictEqual(hops.events, [
      `open ${start}`,
      `fetch #1 ${start}`,
      "cancel #1",
      `close ${start}`,
      `open ${next}`,
      `fetch #2 ${next}`,
      "consumed #2",
      `close ${next}`,
    ]);
    hops.assertInvariants();
  });

  await t.step("one lookup per hop", async () => {
    const start = "https://first.example/start";
    const next = "https://second.example/document";
    const lookups: string[] = [];
    const lookup = (hostname: string) => {
      lookups.push(hostname);
      return Promise.resolve([{ address: "8.8.8.8", family: 4 }]);
    };
    // Bun connects to the IP address with the original Host header, so the
    // stub tells the hops apart by their paths:
    await withFetchStub(
      (request) =>
        new URL(request.url).pathname === "/start"
          ? Response.redirect(next, 302)
          : Response.json({ done: true }),
      async (fetched) => {
        const loader = createAuthenticatedDocumentLoader(identity, {}, {
          openHop: (url) => openPublicFetch(url, { lookup }),
        });
        deepStrictEqual((await loader(start)).document, { done: true });
        deepStrictEqual(lookups, ["first.example", "second.example"]);
        deepStrictEqual(fetched.length, 2);
      },
    );
  });
});

// Captures the debug logs of fedify while running the given function:
async function captureLogs(fn: () => Promise<void>): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  await configure({
    sinks: { buffer: (record) => records.push(record) },
    loggers: [
      { category: "fedify", sinks: ["buffer"], lowestLevel: "debug" },
      { category: ["logtape", "meta"], sinks: [] },
    ],
    reset: true,
  });
  try {
    await fn();
    // Let the rejected cancellations be logged:
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    await reset();
  }
  return records;
}

// Gets the error messages of the logged failures to cancel response bodies:
function getCancelFailures(records: readonly LogRecord[]): string[] {
  return records
    .filter((r) =>
      r.rawMessage === "Failed to cancel the response body from {url}: {error}"
    )
    .map((r) => (r.properties.error as Error).message);
}

const linkAlternate = (next: string): RecordedResponseInit => ({
  headers: {
    "Content-Type": "text/plain",
    Link: `<${next}>; rel="alternate"; type="application/activity+json"`,
  },
  body: "not JSON",
});

const jsonDocument: RecordedResponseInit = {
  headers: { "Content-Type": "application/activity+json" },
  body: '{"done":true}',
};

test("getAuthenticatedDocumentLoader() logs bodies failing to cancel and loads the next hop", async (t) => {
  for (const kind of ["redirect", "Link header alternate"] as const) {
    await t.step(kind, async () => {
      const start = "https://example.com/lifecycle/cancel-failure";
      const next = "https://example.com/lifecycle/cancel-failure-next";
      const hops = recordHops((request): RecordedResponseInit =>
        request.url === start
          ? {
            ...(kind === "redirect"
              ? { status: 302, headers: { Location: next }, body: "Found" }
              : linkAlternate(next)),
            failCancel: true,
          }
          : jsonDocument
      );
      const loader = createAuthenticatedDocumentLoader(identity, {}, hops);
      let document: unknown;
      const records = await captureLogs(async () => {
        document = (await loader(start)).document;
      });
      deepStrictEqual(document, { done: true });
      deepStrictEqual(hops.events, [
        `open ${start}`,
        `fetch #1 ${start}`,
        "cancel #1",
        `close ${start}`,
        `open ${next}`,
        `fetch #2 ${next}`,
        "consumed #2",
        `close ${next}`,
      ]);
      deepStrictEqual(getCancelFailures(records), ["cancel #1 failed"]);
      hops.assertInvariants();
    });
  }
});

test("getAuthenticatedDocumentLoader() is not blocked by a body cancellation that never settles", async (t) => {
  await t.step("redirect and Link header alternate", async () => {
    const start = "https://example.com/lifecycle/hanging-start";
    const page = "https://example.com/lifecycle/hanging-page";
    const next = "https://example.com/lifecycle/hanging-document";
    const hops = recordHops((request): RecordedResponseInit => ({
      ...(request.url === start
        ? { status: 302, headers: { Location: page }, body: "Found" }
        : request.url === page
        ? linkAlternate(next)
        : jsonDocument),
      hangCancel: true,
    }));
    const loader = createAuthenticatedDocumentLoader(identity, {}, hops);
    deepStrictEqual((await loader(start)).document, { done: true });
    deepStrictEqual(hops.events, [
      `open ${start}`,
      `fetch #1 ${start}`,
      "cancel #1",
      `close ${start}`,
      `open ${page}`,
      `fetch #2 ${page}`,
      "cancel #2",
      `close ${page}`,
      `open ${next}`,
      `fetch #3 ${next}`,
      "consumed #3",
      `close ${next}`,
    ]);
    hops.assertInvariants();
  });

  await t.step("not found", async () => {
    const url = "https://example.com/lifecycle/hanging-missing";
    const hops = recordHops((): RecordedResponseInit => ({
      status: 404,
      body: "Not Found",
      hangCancel: true,
    }));
    const loader = createAuthenticatedDocumentLoader(identity, {}, hops);
    await rejects(loader(url), FetchError);
    deepStrictEqual(hops.events.slice(0, 2), [
      `open ${url}`,
      `fetch #1 ${url}`,
    ]);
    deepStrictEqual(hops.events.at(-1), `close ${url}`);
    hops.assertInvariants();
  });
});

test("getAuthenticatedDocumentLoader() completes with responses cloned by fetch-mock", async () => {
  // fetch-mock returns a clone (a tee branch) of a Response instance, whose
  // cancellation never settles on Node.js:
  fetchMock.mockGlobal();
  try {
    const base = "https://example.com/tee/";
    fetchMock.get(
      `${base}start`,
      () =>
        new Response("Found", {
          status: 302,
          headers: { Location: `${base}page` },
        }),
    );
    fetchMock.get(
      `${base}page`,
      () =>
        new Response("not JSON", {
          headers: {
            "Content-Type": "text/plain",
            Link:
              `<${base}document>; rel="alternate"; type="application/activity+json"`,
          },
        }),
    );
    fetchMock.get(
      `${base}document`,
      () =>
        new Response('{"done":true}', {
          headers: { "Content-Type": "application/activity+json" },
        }),
    );
    fetchMock.get(
      `${base}missing`,
      () => new Response("Not Found", { status: 404 }),
    );
    const loader = createAuthenticatedDocumentLoader(identity, {}, directDeps);
    deepStrictEqual((await loader(`${base}start`)).document, { done: true });
    await rejects(loader(`${base}missing`), FetchError);
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

test("getAuthenticatedDocumentLoader() rejects URLs with credentials", async (t) => {
  const identity = {
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  };
  const start = "https://8.8.8.8/start";
  const target = "https://user:pass@8.8.8.8/document";
  for (const allowPrivateAddress of [false, true]) {
    const loader = getAuthenticatedDocumentLoader(identity, {
      allowPrivateAddress,
    });
    for (const path of ["direct", "redirect", "Link", "HTML"]) {
      await t.step(
        `${path}, allowPrivateAddress=${allowPrivateAddress}`,
        async () => {
          await withFetchStub(
            (request) => {
              if (request.url !== start) return Response.json({});
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
              deepStrictEqual(
                fetched.map((r) => r.url),
                path === "direct" ? [] : [start],
              );
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
              deepStrictEqual(fetched.map((r) => r.url), [new URL(url).href]);
            },
          );
        },
      );
    }
  }
  for (
    const firstSpec of ["rfc9421", "draft-cavage-http-signatures-12"] as const
  ) {
    await t.step(`redirect after fallback from ${firstSpec}`, async () => {
      const loader = getAuthenticatedDocumentLoader(identity, {
        allowPrivateAddress: true,
        specDeterminer: {
          determineSpec: () => firstSpec,
          rememberSpec: () => {},
        },
      });
      await withFetchStub(
        (request) =>
          request.url !== start
            ? Response.json({})
            : request.headers.has("Signature-Input") ===
                (firstSpec === "rfc9421")
            ? new Response(null, { status: 401 })
            : Response.redirect(target, 302),
        async (fetched) => {
          await rejects(loader(start), isCredentialUrlError);
          deepStrictEqual(fetched.map((r) => r.url), [start, start]);
          deepStrictEqual(
            fetched.map((r) => r.headers.has("Signature-Input")),
            [firstSpec === "rfc9421", firstSpec !== "rfc9421"],
          );
        },
      );
    });
  }
});

function isUnsupportedProtocolError(error: unknown, url: string): boolean {
  return error instanceof UrlError &&
    error.message === `Unsupported protocol: ${new URL(url).protocol}` &&
    error.reason === "disallowed";
}

async function withFetchStub(
  respond: (request: Request) => Response,
  callback: (fetched: Request[]) => Promise<void>,
): Promise<void> {
  const fetched: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init == null
      ? input
      : new Request(input, init);
    fetched.push(request);
    return Promise.resolve(respond(request));
  }) as typeof globalThis.fetch;
  try {
    await callback(fetched);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const url of unsupportedUrls) {
  const scheme = new URL(url).protocol;
  const loader = getAuthenticatedDocumentLoader({
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  }, { allowPrivateAddress: true });

  test(`getAuthenticatedDocumentLoader() rejects ${scheme} URLs with private addresses allowed before fetching`, async () => {
    await withFetchStub(() => Response.json({}), async (fetched) => {
      await rejects(loader(url), (e) => isUnsupportedProtocolError(e, url));
      deepStrictEqual(fetched, []);
    });
  });

  test(`getAuthenticatedDocumentLoader() rejects redirects to ${scheme} URLs with private addresses allowed`, async () => {
    const start = "https://example.com/redirect-to-unsupported";
    await withFetchStub(() => Response.redirect(url, 302), async (fetched) => {
      await rejects(loader(start), (e) => isUnsupportedProtocolError(e, url));
      deepStrictEqual(fetched.map((r) => r.url), [start]);
    });
  });

  for (
    const firstSpec of ["rfc9421", "draft-cavage-http-signatures-12"] as const
  ) {
    test(`getAuthenticatedDocumentLoader() rejects redirects to ${scheme} URLs after signature fallback from ${firstSpec}`, async () => {
      const start = "https://example.com/fallback-redirect-to-unsupported";
      const fallbackLoader = getAuthenticatedDocumentLoader({
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      }, {
        allowPrivateAddress: true,
        specDeterminer: {
          determineSpec: () => firstSpec,
          rememberSpec: () => {},
        },
      });
      await withFetchStub(
        (request) =>
          request.headers.has("Signature-Input") === (firstSpec === "rfc9421")
            ? new Response("Unauthorized", { status: 401 })
            : Response.redirect(url, 302),
        async (fetched) => {
          await rejects(
            fallbackLoader(start),
            (e) => isUnsupportedProtocolError(e, url),
          );
          deepStrictEqual(fetched.map((r) => r.url), [start, start]);
          deepStrictEqual(
            fetched.map((r) => r.headers.has("Signature-Input")),
            [firstSpec === "rfc9421", firstSpec !== "rfc9421"],
          );
        },
      );
    });
  }

  for (const html of [false, true]) {
    test(
      `getAuthenticatedDocumentLoader() rejects ${
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
              loader(start),
              (e) => isUnsupportedProtocolError(e, url),
            );
            deepStrictEqual(fetched.map((r) => r.url), [start]);
          },
        );
      },
    );
  }
}

interface RecordedResponseInit {
  readonly status?: number;
  readonly headers?: HeadersInit;
  readonly body?: string;
  readonly chunkSize?: number;
  readonly failCancel?: boolean;
  readonly hangCancel?: boolean;
}

interface RecordedResponse {
  readonly response: Response;
  readonly settled: () => boolean;
}

// Creates a response whose body records being read to the end
// ("consumed #n") or cancelled ("cancel #n"):
function createRecordedResponse(
  events: string[],
  index: number,
  init: RecordedResponseInit,
  cancelSuffix: () => string = () => "",
): RecordedResponse {
  const bytes = new TextEncoder().encode(init.body ?? "");
  const chunkSize = init.chunkSize ?? 256;
  let offset = 0;
  let settled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        settled = true;
        events.push(`consumed #${index}`);
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
    cancel() {
      settled = true;
      events.push(`cancel #${index}${cancelSuffix()}`);
      if (init.failCancel) throw new Error(`cancel #${index} failed`);
      // Like a branch of a tee whose other branch is never cancelled:
      if (init.hangCancel) return new Promise<void>(() => {});
    },
  }, { highWaterMark: 0 });
  return {
    response: new Response(body, {
      status: init.status ?? 200,
      headers: init.headers,
    }),
    settled: () => settled,
  };
}

interface HopRecorder {
  readonly events: string[];
  readonly requests: Request[];
  openHop(url: string): Promise<PublicFetchSession>;
  assertInvariants(): void;
}

// Records the lifecycle of the hop sessions.  Like the real sessions, close()
// starts cancelling the bodies that are still unsettled without awaiting it,
// but records them as "cancel #n by close" so that tests can tell them apart.
// The cancel callbacks run synchronously inside cancel(), so they are
// recorded before "close":
function recordHops(
  respond: (
    request: Request,
    index: number,
  ) => RecordedResponseInit | Promise<RecordedResponseInit>,
): HopRecorder {
  const events: string[] = [];
  const requests: Request[] = [];
  const unsettledAtClose: number[] = [];
  let opens = 0;
  let closes = 0;
  let fetches = 0;
  return {
    events,
    requests,
    openHop(url: string): Promise<PublicFetchSession> {
      opens++;
      events.push(`open ${url}`);
      const tracked: (RecordedResponse & { index: number })[] = [];
      let closed = false;
      let closing = false;
      return Promise.resolve({
        url: new URL(url),
        async fetch(input, init) {
          if (closed) throw new TypeError("The session is closed.");
          const request = new Request(
            (input instanceof Request ? input.clone() : input) as
              | Request
              | URL
              | string,
            init,
          );
          const index = ++fetches;
          requests.push(request);
          events.push(`fetch #${index} ${request.url}`);
          const recorded = createRecordedResponse(
            events,
            index,
            await respond(request, index),
            () => closing ? " by close" : "",
          );
          tracked.push({ ...recorded, index });
          return recorded.response;
        },
        close() {
          if (closed) return Promise.resolve();
          closed = true;
          closes++;
          closing = true;
          for (const { response, settled, index } of tracked) {
            if (settled()) continue;
            if (response.body?.locked) unsettledAtClose.push(index);
            else response.body?.cancel().catch(() => {});
          }
          events.push(`close ${url}`);
          return Promise.resolve();
        },
      });
    },
    assertInvariants() {
      deepStrictEqual(opens, closes);
      deepStrictEqual(unsettledAtClose, []);
    },
  };
}
