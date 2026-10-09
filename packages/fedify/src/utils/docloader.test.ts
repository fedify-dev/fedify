import { mockDocumentLoader, test } from "@fedify/fixture";
import { FetchError, UrlError } from "@fedify/vocab-runtime";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { assertEquals, assertRejects } from "@std/assert";
import fetchMock from "fetch-mock";
import dns from "node:dns/promises";
import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import { verifyRequest } from "../sig/http.ts";
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
          () =>
            loader("https://example.com/object", { signal: controller.signal }),
          Error,
        );
      } finally {
        clearTimeout(responseTimer);
      }
    });

    await t.step("immediate cancellation", async () => {
      const loader = getAuthenticatedDocumentLoader({
        keyId: new URL("https://example.com/key2"),
        privateKey: rsaPrivateKey2,
      });

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

test("getAuthenticatedDocumentLoader() logs DNS failures as such", {
  // The validator skips DNS when Deno has no network permission.
  ignore: "Deno" in globalThis &&
    (await Deno.permissions.query({ name: "net" })).state !== "granted",
}, async (t) => {
  const loader = getAuthenticatedDocumentLoader({
    keyId: new URL("https://example.com/key2"),
    privateKey: rsaPrivateKey2,
  });
  for (const result of ["throws", "empty", "private"] as const) {
    await t.step(result, async () => {
      // Stubbing works only because vocab-runtime's url.ts uses the default
      // node:dns/promises import; see the FIXME there.
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
        dns.lookup = originalLookup;
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
