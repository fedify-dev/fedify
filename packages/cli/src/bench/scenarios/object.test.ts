import assert from "node:assert/strict";
import test from "node:test";
import { serve } from "srvx";
import { getContextLoader, getDocumentLoader } from "../../docloader.ts";
import { normalizeSuite } from "../scenario/normalize.ts";
import type { Suite } from "../scenario/types.ts";
import { objectRunner } from "./object.ts";

async function spawnObjectTarget() {
  let objectGets = 0;
  const server = serve({
    port: 0,
    hostname: "127.0.0.1",
    silent: true,
    fetch(request: Request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/users/alice") {
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Person",
          id: new URL("/users/alice", url).href,
          outbox: new URL("/users/alice/outbox", url).href,
        });
      }
      if (url.pathname === "/users/alice/outbox") {
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "OrderedCollection",
          id: url.href,
          orderedItems: [
            {
              type: "Note",
              id: new URL("/objects/1", url).href,
              content: "one",
            },
            {
              type: "Article",
              id: new URL("/objects/2", url).href,
              content: "two",
            },
          ],
        });
      }
      if (url.pathname.startsWith("/objects/")) {
        objectGets++;
        return json({
          "@context": "https://www.w3.org/ns/activitystreams",
          type: url.pathname.endsWith("/1") ? "Note" : "Article",
          id: url.href,
          content: "object",
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  await server.ready();
  return {
    url: new URL(server.url!),
    objectGets: () => objectGets,
    close: () => server.close(true),
  };
}

test("objectRunner - fetches explicit object URLs", async () => {
  const target = await spawnObjectTarget();
  try {
    const suite: Suite = {
      version: 1,
      target: target.url.href,
      scenarios: [{
        name: "object",
        type: "object",
        source: [
          new URL("/objects/1", target.url).href,
          new URL("/objects/2", target.url).href,
        ],
        load: { concurrency: 2 },
        duration: "80ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await objectRunner.run({
      scenario,
      target: target.url,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet: null,
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(target.objectGets() > 0);
  } finally {
    await target.close();
  }
});

test("objectRunner - crawls actor collections before fetching objects", async () => {
  const target = await spawnObjectTarget();
  try {
    const suite: Suite = {
      version: 1,
      target: target.url.href,
      scenarios: [{
        name: "object-crawl",
        type: "object",
        source: {
          seed: new URL("/users/alice", target.url).href,
          collection: "outbox",
          limit: 1,
          type: "Note",
        },
        load: { concurrency: 1 },
        duration: "80ms",
      }],
    };
    const scenario = normalizeSuite(suite).scenarios[0];
    const measurement = await objectRunner.run({
      scenario,
      target: target.url,
      documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
      contextLoader: await getContextLoader({ allowPrivateAddress: true }),
      allowPrivateAddress: true,
      fleet: null,
    });

    assert.ok(measurement.requests.total > 0);
    assert.strictEqual(measurement.requests.successRate, 1);
    assert.ok(target.objectGets() > 0);
  } finally {
    await target.close();
  }
});

test("objectRunner - unwraps activities while crawling object sources", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
        type: "Note",
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let fetchedObjectUrl = "";

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice") {
        return Promise.resolve(json({
          id: url.href,
          outbox: "http://target.test/users/alice/outbox",
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        return Promise.resolve(json({
          id: url.href,
          orderedItems: [{
            type: "Create",
            id: "http://target.test/activities/create-1",
            object: {
              type: "Note",
              id: "http://target.test/objects/1",
            },
          }],
        }));
      }
      if (url.pathname === "/objects/1") {
        fetchedObjectUrl = url.href;
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(fetchedObjectUrl, "http://target.test/objects/1");
});

test("objectRunner - selects matching objects from activity arrays", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
        type: "Note",
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let fetchedObjectUrl = "";

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice") {
        return Promise.resolve(json({
          id: url.href,
          outbox: "http://target.test/users/alice/outbox",
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        return Promise.resolve(json({
          id: url.href,
          orderedItems: [{
            type: "Create",
            id: "http://target.test/activities/create-1",
            object: [
              { type: "Article", id: "http://target.test/objects/article" },
              "http://target.test/objects/url-only",
              { type: "Note", id: "http://target.test/objects/note" },
            ],
          }],
        }));
      }
      if (url.pathname === "/objects/note") {
        fetchedObjectUrl = url.href;
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(fetchedObjectUrl, "http://target.test/objects/note");
});

test("objectRunner - prefers unwrapped object URLs without type filters", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let fetchedActivity = false;
  let fetchedObject = false;

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice") {
        return Promise.resolve(json({
          id: url.href,
          outbox: "http://target.test/users/alice/outbox",
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        return Promise.resolve(json({
          id: url.href,
          orderedItems: [{
            type: "Create",
            id: "http://target.test/activities/create-1",
            object: "http://target.test/objects/1",
          }],
        }));
      }
      if (url.pathname === "/activities/create-1") {
        fetchedActivity = true;
        return Promise.resolve(json({ id: url.href, type: "Create" }));
      }
      if (url.pathname === "/objects/1") {
        fetchedObject = true;
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(fetchedObject, true);
  assert.strictEqual(fetchedActivity, false);
});

test("objectRunner - sends ActivityPub Accept headers during object discovery", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  const discoveryAccepts: string[] = [];

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice") {
        discoveryAccepts.push(request.headers.get("accept") ?? "");
        return Promise.resolve(json({
          id: url.href,
          outbox: "http://target.test/users/alice/outbox",
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        discoveryAccepts.push(request.headers.get("accept") ?? "");
        return Promise.resolve(json({
          id: url.href,
          orderedItems: ["http://target.test/objects/1"],
        }));
      }
      if (url.pathname === "/objects/1") {
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.deepStrictEqual(discoveryAccepts, [
    "application/activity+json, application/ld+json",
    "application/activity+json, application/ld+json",
  ]);
});

test("objectRunner - skips URL-only collection items for type filters", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
        type: "Note",
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];

  await assert.rejects(
    async () =>
      objectRunner.run({
        scenario,
        target: new URL("http://target.test/"),
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
        fetch: (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === "/users/alice") {
            return Promise.resolve(json({
              id: url.href,
              outbox: "http://target.test/users/alice/outbox",
            }));
          }
          if (url.pathname === "/users/alice/outbox") {
            return Promise.resolve(json({
              id: url.href,
              orderedItems: ["http://target.test/objects/article"],
            }));
          }
          return Promise.resolve(json({
            id: url.href,
            type: "Article",
          }));
        },
      }),
    /did not resolve any URLs/,
  );
});

test("objectRunner - gates discovery URLs before fetching them", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://public.example/users/alice",
        collection: "outbox",
        limit: 1,
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];

  await assert.rejects(
    async () =>
      objectRunner.run({
        scenario,
        target: new URL("http://target.test/"),
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
        fetch: () => {
          throw new Error("discovery fetch should be gated first");
        },
        assertReadDestinationAllowed: (url) => {
          throw new Error(`refused ${url.href}`);
        },
      }),
    /refused http:\/\/public\.example\/users\/alice/,
  );
});

test("objectRunner - gates collection URLs before crawling them", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];

  await assert.rejects(
    async () =>
      objectRunner.run({
        scenario,
        target: new URL("http://target.test/"),
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
        fetch: (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          if (url.pathname === "/users/alice") {
            return Promise.resolve(json({
              id: url.href,
              outbox: "http://public.example/outbox",
            }));
          }
          throw new Error("collection fetch should be gated first");
        },
        assertReadDestinationAllowed: (url) => {
          if (url.hostname === "public.example") {
            throw new Error(`refused ${url.href}`);
          }
        },
      }),
    /refused http:\/\/public\.example\/outbox/,
  );
});

test("objectRunner - drains failed discovery responses", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  const failed = new Response("forbidden", { status: 403 });

  await assert.rejects(
    async () =>
      await objectRunner.run({
        scenario,
        target: new URL("http://target.test/"),
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
        fetch: () => Promise.resolve(failed),
      }),
    /Failed to fetch http:\/\/target\.test\/users\/alice: HTTP 403/,
  );
  assert.strictEqual(failed.bodyUsed, true);
});

test("objectRunner - resolves relative URLs while crawling object sources", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice/",
        collection: "outbox",
        limit: 1,
        type: "Note",
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  const fetched: string[] = [];

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      fetched.push(url.href);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice/") {
        return Promise.resolve(json({
          id: url.href,
          outbox: "outbox",
        }));
      }
      if (url.pathname === "/users/alice/outbox" && url.search === "?page=1") {
        return Promise.resolve(json({
          id: url.href,
          next: "?page=2",
          orderedItems: [],
        }));
      }
      if (url.pathname === "/users/alice/outbox" && url.search === "?page=2") {
        return Promise.resolve(json({
          id: url.href,
          orderedItems: [{
            type: "Create",
            object: {
              type: "Note",
              id: "./objects/relative",
            },
          }],
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        return Promise.resolve(json({
          id: url.href,
          first: "?page=1",
        }));
      }
      if (url.pathname === "/users/alice/objects/relative") {
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.ok(fetched.includes("http://target.test/users/alice/outbox"));
  assert.ok(fetched.includes("http://target.test/users/alice/outbox?page=1"));
  assert.ok(fetched.includes("http://target.test/users/alice/outbox?page=2"));
  assert.ok(
    fetched.includes("http://target.test/users/alice/objects/relative"),
  );
});

test("objectRunner - resolves Link object href values while crawling", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice/",
        collection: "outbox",
        limit: 1,
        type: "Note",
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  const fetched: string[] = [];

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      fetched.push(url.href);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice/") {
        return Promise.resolve(json({
          id: url.href,
          outbox: {
            type: "Link",
            href: "outbox",
          },
        }));
      }
      if (url.pathname === "/users/alice/outbox" && url.search === "?page=1") {
        return Promise.resolve(json({
          id: url.href,
          orderedItems: [{
            type: "Create",
            object: {
              type: "Note",
              id: {
                type: "Link",
                href: "../objects/note",
              },
            },
          }],
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        return Promise.resolve(json({
          id: url.href,
          first: {
            type: "Link",
            href: "?page=1",
          },
        }));
      }
      if (url.pathname === "/users/objects/note") {
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.ok(fetched.includes("http://target.test/users/alice/outbox"));
  assert.ok(fetched.includes("http://target.test/users/alice/outbox?page=1"));
  assert.ok(fetched.includes("http://target.test/users/objects/note"));
});

test("objectRunner - skips malformed URLs while crawling object sources", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let fetchedObjectUrl = "";

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice") {
        return Promise.resolve(json({
          id: url.href,
          outbox: "http://target.test/users/alice/outbox",
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        return Promise.resolve(json({
          id: url.href,
          orderedItems: [
            "http://[malformed",
            {
              type: "Note",
              id: {
                type: "Link",
                href: "http://[malformed",
              },
            },
            {
              type: "Note",
              id: "http://target.test/objects/valid",
            },
          ],
        }));
      }
      if (url.pathname === "/objects/valid") {
        fetchedObjectUrl = url.href;
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(fetchedObjectUrl, "http://target.test/objects/valid");
});

test("objectRunner - continues after malformed activity object URLs", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let fetchedObjectUrl = "";

  const measurement = await objectRunner.run({
    scenario,
    target: new URL("http://target.test/"),
    documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
    contextLoader: await getContextLoader({ allowPrivateAddress: true }),
    allowPrivateAddress: true,
    fleet: null,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/fedify/bench/stats") {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      if (url.pathname === "/users/alice") {
        return Promise.resolve(json({
          id: url.href,
          outbox: "http://target.test/users/alice/outbox",
        }));
      }
      if (url.pathname === "/users/alice/outbox") {
        return Promise.resolve(json({
          id: url.href,
          orderedItems: [{
            type: "Create",
            object: [
              "http://[malformed",
              {
                type: "Note",
                id: "http://target.test/objects/valid",
              },
            ],
          }],
        }));
      }
      if (url.pathname === "/objects/valid") {
        fetchedObjectUrl = url.href;
        return Promise.resolve(json({ id: url.href, type: "Note" }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    },
  });

  assert.ok(measurement.requests.total > 0);
  assert.strictEqual(fetchedObjectUrl, "http://target.test/objects/valid");
});

test("objectRunner - caps object source crawl pages", async () => {
  const scenario = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: "http://target.test/users/alice",
        collection: "outbox",
        limit: 1,
        type: "Note",
      },
      load: { concurrency: 1 },
      duration: "25ms",
    }],
  }).scenarios[0];
  let pageFetches = 0;

  await assert.rejects(
    async () =>
      await objectRunner.run({
        scenario,
        target: new URL("http://target.test/"),
        documentLoader: await getDocumentLoader({ allowPrivateAddress: true }),
        contextLoader: await getContextLoader({ allowPrivateAddress: true }),
        allowPrivateAddress: true,
        fleet: null,
        fetch: (input) => {
          const request = input instanceof Request ? input : new Request(input);
          const url = new URL(request.url);
          if (url.pathname === "/users/alice") {
            return Promise.resolve(json({
              id: url.href,
              outbox: "http://target.test/outbox?page=0",
            }));
          }
          if (url.pathname === "/outbox") {
            pageFetches++;
            const page = Number(url.searchParams.get("page") ?? 0);
            return Promise.resolve(json({
              id: url.href,
              orderedItems: [{
                type: "Article",
                id: `http://target.test/articles/${page}`,
              }],
              next: `?page=${page + 1}`,
            }));
          }
          return Promise.resolve(new Response("not found", { status: 404 }));
        },
      }),
    /did not resolve any URLs/,
  );

  assert.strictEqual(pageFetches, 100);
});

test("objectRunner.validate - rejects malformed object source URLs", () => {
  const explicit = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object",
      type: "object",
      source: "objects/1",
    }],
  }).scenarios[0];
  assert.throws(
    () => objectRunner.validate?.(explicit),
    /invalid object source URL/,
  );

  const crawl = normalizeSuite({
    version: 1,
    target: "http://target.test/",
    scenarios: [{
      name: "object-crawl",
      type: "object",
      source: {
        seed: ["http://target.test/users/alice", "users/bob"],
      },
    }],
  }).scenarios[0];
  assert.throws(
    () => objectRunner.validate?.(crawl),
    /invalid object source seed URL/,
  );
});

test("objectRunner.validate - rejects non-fetchable direct object source URLs", () => {
  for (
    const source of [
      "ftp://target.test/objects/1",
      "http://user:pass@target.test/objects/1",
    ]
  ) {
    const scenario = normalizeSuite({
      version: 1,
      target: "http://target.test/",
      scenarios: [{
        name: "object",
        type: "object",
        source,
      }],
    }).scenarios[0];

    assert.throws(
      () => objectRunner.validate?.(scenario),
      /object source URL must be a bare http\(s\) URL/,
    );
  }
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/activity+json" },
  });
}
