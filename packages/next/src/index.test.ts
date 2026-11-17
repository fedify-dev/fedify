import {
  createFederation,
  InProcessMessageQueue,
  MemoryKvStore,
} from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  fedifyWith,
  integrateFederation,
  isFederationRequest,
  isHashlinkMediaRequest,
  isNodeInfoRequest,
} from "./index.ts";

test("Accept header detection", () => {
  const request = new Request("https://example.com/", {
    headers: {
      Accept: "application/activity+json",
    },
  });

  assert.strictEqual(isFederationRequest(request), true);
});

test("Content-Type header detection", () => {
  const request = new Request("https://example.com/", {
    method: "POST",
    headers: {
      "Content-Type": "application/activity+json",
    },
  });

  assert.strictEqual(isFederationRequest(request), true);
});

test("NodeInfo route detection", () => {
  const request1 = new Request("https://example.com/.well-known/nodeinfo", {});

  const request2 = new Request(
    "https://example.com/.well-known/x-nodeinfo2",
    {},
  );

  assert.strictEqual(isNodeInfoRequest(request1), true);
  assert.strictEqual(isNodeInfoRequest(request2), true);
});

test("Non-federation request delegation", async () => {
  const federation = createFederation({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
  });
  const customMiddleware = (request: Request) => {
    if (request.url === "https://example.com/test") {
      return new Response("Custom middleware response");
    }
    return new Response("Default response");
  };
  const middleware = fedifyWith(federation)(customMiddleware);

  const request = new Request("https://example.com/", {
    headers: {
      Accept: "text/html",
    },
  });

  const request2 = new Request("https://example.com/test", {
    headers: {
      Accept: "text/html",
    },
  });

  assert.strictEqual(isFederationRequest(request), false);
  assert.strictEqual(isFederationRequest(request2), false);

  const response1 = (await middleware(request)) as Response;
  const response2 = (await middleware(request2)) as Response;

  assert.strictEqual(await response1.text(), "Default response");
  assert.strictEqual(await response2.text(), "Custom middleware response");
});

test("Custom not-found/not acceptable handler", async () => {
  const federation = createFederation({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
  });

  // Set up a dispatcher that always returns null to simulate a not acceptable scenario
  federation.setActorDispatcher("/users/{identifier}", () => null);

  const handler = integrateFederation(federation, undefined, {
    onNotFound: () => new Response("Custom not found", { status: 418 }),
    onNotAcceptable: () =>
      new Response("Custom not acceptable", { status: 418 }),
  });

  const response1 = await handler(
    new Request("https://example.com/missing", {
      headers: { Accept: "application/activity+json" },
    }),
  );

  assert.strictEqual(response1.status, 418);
  assert.strictEqual(await response1.text(), "Custom not found");

  const response2 = await handler(
    new Request("https://example.com/users/123", {
      headers: { Accept: "text/html" },
    }),
  );

  assert.strictEqual(response2.status, 418);
  assert.strictEqual(await response2.text(), "Custom not acceptable");
});

const DIGEST = "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n";

test("Hashlink media route detection", () => {
  for (const path of [
    `/.well-known/apgateway/hl:${DIGEST}`,
    `/.well-known/apgateway/hl%3A${DIGEST}`,
    `/.well-known/apgateway/hl%3a${DIGEST}`,
    `/.well-known/apgateway/HL:${DIGEST}`,
    `/.well-known/apgateway/hl:${DIGEST}?foo=bar`,
    "/.well-known/apgateway/hl:uEiA/digest/with/slashes",
    "/.well-known/apgateway/hl:%ZZ",
  ]) {
    for (const accept of ["image/*", "*/*", null]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        const request = new Request(`https://example.com${path}`, {
          method,
          headers: accept == null ? {} : { Accept: accept },
        });
        assert.strictEqual(isHashlinkMediaRequest(request), true, path);
        assert.strictEqual(isFederationRequest(request), true, path);
      }
    }
  }
  for (const path of [
    "/.well-known/apgateway",
    "/.well-known/apgateway/",
    `/.well-known/apgatewayhl:${DIGEST}`,
    `/.well-known/apgateway-media/hl:${DIGEST}`,
    `/.WELL-KNOWN/apgateway/hl:${DIGEST}`,
    `/foo/.well-known/apgateway/hl:${DIGEST}`,
    `/.well-known/apgateway/did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2/hl:${DIGEST}`,
    `/hl:${DIGEST}`,
  ]) {
    const request = new Request(`https://example.com${path}`, {
      headers: { Accept: "text/html" },
    });
    assert.strictEqual(isHashlinkMediaRequest(request), false, path);
    assert.strictEqual(isFederationRequest(request), false, path);
  }
});

// The same matcher as the one in the documentation, the `fedify init`
// template, and the example:
const MIDDLEWARE_CONFIG = {
  matcher: [
    {
      source: "/:path*",
      has: [
        {
          type: "header" as const,
          key: "Accept",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    {
      source: "/:path*",
      has: [
        {
          type: "header" as const,
          key: "content-type",
          value: ".*application\\/((jrd|activity|ld)\\+json|xrd\\+xml).*",
        },
      ],
    },
    { source: "/.well-known/nodeinfo" },
    { source: "/.well-known/x-nodeinfo2" },
    { source: "/.well-known/apgateway/:path*" },
  ],
};

test("Middleware matcher runs on hashlink media requests", async () => {
  // Next.js's server modules expect AsyncLocalStorage to be a global:
  const globals = globalThis as { AsyncLocalStorage?: unknown };
  globals.AsyncLocalStorage ??= AsyncLocalStorage;
  const { unstable_doesMiddlewareMatch } =
    await import("next/experimental/testing/server");
  const matches = (url: string, headers: Record<string, string> = {}) =>
    unstable_doesMiddlewareMatch({ config: MIDDLEWARE_CONFIG, url, headers });
  for (const url of [
    `/.well-known/apgateway/hl:${DIGEST}`,
    `/.well-known/apgateway/hl%3A${DIGEST}`,
    `/.well-known/apgateway/hl%3a${DIGEST}`,
    `/.well-known/apgateway/HL:${DIGEST}`,
    `/.well-known/apgateway/hl:${DIGEST}?foo=bar`,
    "/.well-known/apgateway/hl:uEiA/digest/with/slashes",
  ]) {
    assert.strictEqual(matches(url, { accept: "image/*" }), true, url);
    assert.strictEqual(matches(url, { accept: "*/*" }), true, url);
    assert.strictEqual(matches(url), true, url);
  }
  assert.strictEqual(matches("/.well-known/nodeinfo"), true);
  assert.strictEqual(
    matches("/users/alice", { accept: "application/activity+json" }),
    true,
  );
  assert.strictEqual(matches("/users/alice", { accept: "text/html" }), false);
  // The middleware also runs on other gateway requests, but fedifyWith()
  // leaves them to Next.js unless they have federation headers:
  assert.strictEqual(
    matches(
      "/.well-known/apgateway/did:key:" +
        "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2/notes/1",
      { accept: "text/html" },
    ),
    true,
  );
});

function createHashlinkFederation(
  dispatch: (digestMultibase: string) => Response | null,
) {
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    queue: new InProcessMessageQueue(),
  });
  federation.setHashlinkMediaDispatcher((_ctx, media) =>
    dispatch(media.digestMultibase),
  );
  return federation;
}

test("Hashlink media request forwarding", async () => {
  const dispatched: string[] = [];
  const federation = createHashlinkFederation((digestMultibase) => {
    dispatched.push(digestMultibase);
    return digestMultibase === DIGEST
      ? new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          },
        )
      : null;
  });
  const fallback: string[] = [];
  const middleware = fedifyWith(federation)((request: Request) => {
    fallback.push(new URL(request.url).pathname);
    return new Response("Next.js response", { status: 299 });
  }) as (request: Request) => Promise<Response>;

  for (const accept of ["image/*", "*/*", null]) {
    const response = await middleware(
      new Request(`https://example.com/.well-known/apgateway/hl:${DIGEST}`, {
        headers: accept == null ? {} : { Accept: accept },
      }),
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("Content-Type"), "image/png");
    assert.strictEqual(
      response.headers.get("Cache-Control"),
      "public, max-age=31536000, immutable",
    );
    assert.deepStrictEqual(
      new Uint8Array(await response.arrayBuffer()),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  }

  const query = await middleware(
    new Request(
      `https://example.com/.well-known/apgateway/hl:${DIGEST}?foo=bar`,
      { headers: { Accept: "image/*" } },
    ),
  );
  assert.strictEqual(query.status, 200);
  await query.body?.cancel();

  const head = await middleware(
    new Request(`https://example.com/.well-known/apgateway/hl%3A${DIGEST}`, {
      method: "HEAD",
    }),
  );
  assert.strictEqual(head.status, 200);
  assert.strictEqual(head.body, null);

  const post = await middleware(
    new Request(`https://example.com/.well-known/apgateway/hl:${DIGEST}`, {
      method: "POST",
      body: "foo",
    }),
  );
  assert.strictEqual(post.status, 405);

  const malformed = await middleware(
    new Request("https://example.com/.well-known/apgateway/hl:%ZZ", {
      headers: { Accept: "image/*" },
    }),
  );
  assert.strictEqual(malformed.status, 400);

  const missing = await middleware(
    new Request(
      "https://example.com/.well-known/apgateway/hl:" +
        "zQmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx",
      { headers: { Accept: "image/*" } },
    ),
  );
  assert.strictEqual(missing.status, 404);

  assert.deepStrictEqual(fallback, []);
  assert.deepStrictEqual(dispatched, [
    DIGEST,
    DIGEST,
    DIGEST,
    DIGEST,
    DIGEST,
    "zQmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx",
  ]);

  // Other gateway requests without federation headers are left to Next.js:
  const html = await middleware(
    new Request(
      "https://example.com/.well-known/apgateway/did:key:" +
        "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2/notes/1",
      { headers: { Accept: "text/html" } },
    ),
  );
  assert.strictEqual(html.status, 299);
  assert.strictEqual(await html.text(), "Next.js response");

  // Fedify matches the gateway path case-sensitively:
  const upper = await middleware(
    new Request(`https://example.com/.WELL-KNOWN/apgateway/hl:${DIGEST}`, {
      headers: { Accept: "image/*" },
    }),
  );
  assert.strictEqual(upper.status, 299);
  assert.deepStrictEqual(fallback, [
    "/.well-known/apgateway/did:key:" +
      "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2/notes/1",
    `/.WELL-KNOWN/apgateway/hl:${DIGEST}`,
  ]);
});

test("Hashlink media requests not found", async () => {
  const request = () =>
    new Request(`https://example.com/.well-known/apgateway/hl:${DIGEST}`, {
      headers: { Accept: "image/*" },
    });
  const federations = [
    // Without a hashlink media dispatcher:
    createFederation<void>({
      kv: new MemoryKvStore(),
      queue: new InProcessMessageQueue(),
    }),
    // With a hashlink media dispatcher that returns null:
    createHashlinkFederation(() => null),
  ];
  for (const federation of federations) {
    const fallback: string[] = [];
    const customMiddleware = (request: Request) => {
      fallback.push(new URL(request.url).pathname);
      return new Response("Next.js response", { status: 299 });
    };

    const middleware1 = fedifyWith(federation)(customMiddleware) as (
      request: Request,
    ) => Promise<Response>;
    const response1 = await middleware1(request());
    assert.strictEqual(response1.status, 404);

    const middleware2 = fedifyWith(federation, undefined, {
      onNotFound: () => new Response("Custom not found", { status: 418 }),
    })(customMiddleware) as (request: Request) => Promise<Response>;
    const response2 = await middleware2(request());
    assert.strictEqual(response2.status, 418);
    assert.strictEqual(await response2.text(), "Custom not found");

    assert.deepStrictEqual(fallback, []);
  }
});

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Next.js normally installs this global during server startup.  Initialize it
// before loading Next.js so its matcher testing utilities use the real storage.
if (!("AsyncLocalStorage" in globalThis)) {
  Object.assign(globalThis, { AsyncLocalStorage });
}
const integration = import("./index.ts");

type MatcherConfig = Parameters<
  typeof import("next/experimental/testing/server.js").unstable_doesMiddlewareMatch
>[0]["config"];

const origin = "https://example.com";
const accepts = ["application/json", "*/*", null];

/** Create a request while preserving the absent-Accept regression case. */
function request(path: string, accept: string | null): Request {
  return new Request(`${origin}${path}`, {
    headers: accept == null ? {} : { Accept: accept },
  });
}

/** Load the real config literal without importing the example application's code. */
function readMatcherConfig(path: string): MatcherConfig {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const match = source.match(/export const config = (\{[\s\S]*?\n\});/);
  assert.ok(match, `Missing standalone config in ${path}`);
  return runInNewContext(`(${match[1]})`) as MatcherConfig;
}

test("NodeInfo paths are recognized without federation media types", async () => {
  const { isNodeInfoRequest, isFederationRequest } = await integration;
  for (const accept of accepts) {
    for (const path of [
      "/nodeinfo/",
      "/nodeinfo/2.0",
      "/nodeinfo/2.1",
      "/nodeinfo/2.1/",
      "/nodeinfo/2.1?foo=bar",
      "/nodeinfo/nested/2.1",
      "/.well-known/nodeinfo",
      "/.well-known/x-nodeinfo2",
    ]) {
      const req = request(path, accept);
      assert.equal(isNodeInfoRequest(req), true, path);
      assert.equal(isFederationRequest(req), true, path);
    }
    for (const path of [
      "/nodeinfo",
      "/nodeinfo.json",
      "/nodeinfo-other/2.1",
      "/nodeinformation/2.1",
      "/api/nodeinfo/2.1",
      "/NodeInfo/2.1",
      "/users/alice",
    ]) {
      const req = request(path, accept);
      assert.equal(isNodeInfoRequest(req), false, path);
      assert.equal(isFederationRequest(req), false, path);
    }
  }
});

test("Federation media types are still recognized on other paths", async () => {
  const { isFederationRequest } = await integration;
  for (const header of ["Accept", "Content-Type"]) {
    for (const value of [
      "application/activity+json",
      "application/ld+json",
      "application/jrd+json",
      "application/xrd+xml",
    ]) {
      assert.equal(
        isFederationRequest(
          new Request(`${origin}/users/alice`, {
            headers: { [header]: value },
          }),
        ),
        true,
      );
    }
  }
});

for (const accept of accepts) {
  test(`fedifyWith serves NodeInfo with Accept: ${accept ?? "(absent)"}`, async () => {
    const { fedifyWith } = await integration;
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
      software: { name: "example", version: "1.0.0" },
      protocols: ["activitypub"],
      usage: { users: { total: 1 }, localPosts: 2, localComments: 3 },
    }));
    let fallbackCalls = 0;
    const middleware = fedifyWith(federation)(() => {
      fallbackCalls++;
      return new Response("Next.js fallback", { status: 299 });
    });

    const discovery = (await middleware(
      request("/.well-known/nodeinfo", accept),
    )) as Response;
    assert.equal(discovery.status, 200);
    assert.equal(discovery.headers.get("Content-Type"), "application/jrd+json");
    const descriptor = await discovery.json();
    assert.equal(descriptor.links[0].href, `${origin}/nodeinfo/2.1`);
    assert.equal(
      descriptor.links[0].rel,
      "http://nodeinfo.diaspora.software/ns/schema/2.1",
    );

    for (const suffix of ["", "?foo=bar"]) {
      const response = (await middleware(
        new Request(descriptor.links[0].href + suffix, {
          headers: accept == null ? {} : { Accept: accept },
        }),
      )) as Response;
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("Content-Type")!,
        /^application\/json;/,
      );
      const nodeInfo = await response.json();
      assert.equal(nodeInfo.version, "2.1");
      assert.deepEqual(nodeInfo.software, {
        name: "example",
        version: "1.0.0",
      });
      assert.equal(nodeInfo.usage.users.total, 1);
    }
    assert.equal(fallbackCalls, 0);

    for (const path of ["/nodeinfo/", "/nodeinfo/9.9", "/nodeinfo/2.1/"]) {
      const response = (await middleware(request(path, accept))) as Response;
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "Not found");
    }
    assert.equal(fallbackCalls, 0);

    for (const path of ["/nodeinfo", "/nodeinfo-other/2.1", "/about"]) {
      const response = (await middleware(request(path, accept))) as Response;
      assert.equal(response.status, 299);
      assert.equal(await response.text(), "Next.js fallback");
    }
    assert.equal(fallbackCalls, 3);
  });
}

test("NodeInfo prefix requests reach Fedify even without a dispatcher", async () => {
  const { fedifyWith } = await integration;
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let fallbackCalls = 0;
  const fallback = () => {
    fallbackCalls++;
    return new Response("Next.js fallback", { status: 299 });
  };
  for (const custom of [false, true]) {
    const middleware = fedifyWith(
      federation,
      undefined,
      custom
        ? {
            onNotFound: () => new Response("Custom not found", { status: 418 }),
          }
        : {},
    )(fallback);
    const response = (await middleware(
      request("/nodeinfo/2.1", "application/json"),
    )) as Response;
    assert.equal(response.status, custom ? 418 : 404);
    assert.equal(
      await response.text(),
      custom ? "Custom not found" : "Not found",
    );
  }
  assert.equal(fallbackCalls, 0);
});

for (const path of [
  "../../../examples/next-integration/proxy.ts",
  "../../init/src/templates/next/middleware.ts.tpl",
]) {
  test(`Actual matcher forwards NodeInfo discovery and documents: ${path}`, async () => {
    const { unstable_doesMiddlewareMatch } =
      await import("next/experimental/testing/server.js");
    const { fedifyWith } = await integration;
    const config = readMatcherConfig(path);
    const federation = createFederation<void>({ kv: new MemoryKvStore() });
    federation.setNodeInfoDispatcher("/nodeinfo/2.1", () => ({
      software: { name: "example", version: "1.0.0" },
      protocols: ["activitypub"],
      usage: { users: { total: 1 }, localPosts: 0, localComments: 0 },
    }));
    const middleware = fedifyWith(federation)(() => {
      assert.fail("NodeInfo requests must not reach the application fallback");
    });

    for (const accept of accepts) {
      for (const route of ["/.well-known/nodeinfo", "/nodeinfo/2.1"]) {
        const req = request(route, accept);
        assert.equal(
          unstable_doesMiddlewareMatch({
            config,
            url: req.url,
            headers: Object.fromEntries(req.headers),
          }),
          true,
          `${path}: ${route}, Accept: ${accept ?? "(absent)"}`,
        );
        const response = (await middleware(req)) as Response;
        assert.equal(response.status, 200);
        const body = await response.json();
        if (route === "/.well-known/nodeinfo") {
          assert.equal(body.links[0].href, `${origin}/nodeinfo/2.1`);
        } else {
          assert.equal(body.version, "2.1");
          assert.equal(body.software.name, "example");
        }
      }
    }
    assert.equal(
      unstable_doesMiddlewareMatch({ config, url: `${origin}/about` }),
      false,
    );
  });
}
