import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
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
    for (
      const path of [
        "/nodeinfo/",
        "/nodeinfo/2.0",
        "/nodeinfo/2.1",
        "/nodeinfo/2.1/",
        "/nodeinfo/2.1?foo=bar",
        "/nodeinfo/nested/2.1",
        "/.well-known/nodeinfo",
        "/.well-known/x-nodeinfo2",
      ]
    ) {
      const req = request(path, accept);
      assert.equal(isNodeInfoRequest(req), true, path);
      assert.equal(isFederationRequest(req), true, path);
    }
    for (
      const path of [
        "/nodeinfo",
        "/nodeinfo.json",
        "/nodeinfo-other/2.1",
        "/nodeinformation/2.1",
        "/api/nodeinfo/2.1",
        "/NodeInfo/2.1",
        "/users/alice",
      ]
    ) {
      const req = request(path, accept);
      assert.equal(isNodeInfoRequest(req), false, path);
      assert.equal(isFederationRequest(req), false, path);
    }
  }
});

test("Federation media types are still recognized on other paths", async () => {
  const { isFederationRequest } = await integration;
  for (const header of ["Accept", "Content-Type"]) {
    for (
      const value of [
        "application/activity+json",
        "application/ld+json",
        "application/jrd+json",
        "application/xrd+xml",
      ]
    ) {
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

    const discovery = await middleware(
      request("/.well-known/nodeinfo", accept),
    ) as Response;
    assert.equal(discovery.status, 200);
    assert.equal(discovery.headers.get("Content-Type"), "application/jrd+json");
    const descriptor = await discovery.json();
    assert.equal(descriptor.links[0].href, `${origin}/nodeinfo/2.1`);
    assert.equal(
      descriptor.links[0].rel,
      "http://nodeinfo.diaspora.software/ns/schema/2.1",
    );

    for (const suffix of ["", "?foo=bar"]) {
      const response = await middleware(
        new Request(
          descriptor.links[0].href + suffix,
          { headers: accept == null ? {} : { Accept: accept } },
        ),
      ) as Response;
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
      const response = await middleware(request(path, accept)) as Response;
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "Not found");
    }
    assert.equal(fallbackCalls, 0);

    for (const path of ["/nodeinfo", "/nodeinfo-other/2.1", "/about"]) {
      const response = await middleware(request(path, accept)) as Response;
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
    const response = await middleware(
      request("/nodeinfo/2.1", "application/json"),
    ) as Response;
    assert.equal(response.status, custom ? 418 : 404);
    assert.equal(
      await response.text(),
      custom ? "Custom not found" : "Not found",
    );
  }
  assert.equal(fallbackCalls, 0);
});

for (
  const path of [
    "../../../examples/next-integration/proxy.ts",
    "../../init/src/templates/next/middleware.ts.tpl",
  ]
) {
  test(`Actual matcher forwards NodeInfo discovery and documents: ${path}`, async () => {
    const { unstable_doesMiddlewareMatch } = await import(
      "next/experimental/testing/server.js"
    );
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
        const response = await middleware(req) as Response;
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
