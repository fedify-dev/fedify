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

  const response1 = await middleware(request);
  const response2 = await middleware(request2);

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
  for (
    const path of [
      `/.well-known/apgateway/hl:${DIGEST}`,
      `/.well-known/apgateway/hl%3A${DIGEST}`,
      `/.well-known/apgateway/hl%3a${DIGEST}`,
      `/.well-known/apgateway/HL:${DIGEST}`,
      `/.well-known/apgateway/hl:${DIGEST}?foo=bar`,
      "/.well-known/apgateway/hl:uEiA/digest/with/slashes",
      "/.well-known/apgateway/hl:%ZZ",
    ]
  ) {
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
  for (
    const path of [
      "/.well-known/apgateway",
      "/.well-known/apgateway/",
      `/.well-known/apgatewayhl:${DIGEST}`,
      `/.well-known/apgateway-media/hl:${DIGEST}`,
      `/.WELL-KNOWN/apgateway/hl:${DIGEST}`,
      `/foo/.well-known/apgateway/hl:${DIGEST}`,
      `/.well-known/apgateway/did:key:z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2/hl:${DIGEST}`,
      `/hl:${DIGEST}`,
    ]
  ) {
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
  const { unstable_doesMiddlewareMatch } = await import(
    "next/experimental/testing/server"
  );
  const matches = (url: string, headers: Record<string, string> = {}) =>
    unstable_doesMiddlewareMatch({ config: MIDDLEWARE_CONFIG, url, headers });
  for (
    const url of [
      `/.well-known/apgateway/hl:${DIGEST}`,
      `/.well-known/apgateway/hl%3A${DIGEST}`,
      `/.well-known/apgateway/hl%3a${DIGEST}`,
      `/.well-known/apgateway/HL:${DIGEST}`,
      `/.well-known/apgateway/hl:${DIGEST}?foo=bar`,
      "/.well-known/apgateway/hl:uEiA/digest/with/slashes",
    ]
  ) {
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
    dispatch(media.digestMultibase)
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
