import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import { fedifyWith, isFederationRequest, isNodeInfoRequest } from "./index.ts";

const origin = "https://example.com";
const accepts = ["application/json", "*/*", null];

function request(path: string, accept: string | null): Request {
  return new Request(`${origin}${path}`, {
    headers: accept == null ? {} : { Accept: accept },
  });
}

test("NodeInfo paths are recognized without federation media types", () => {
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

test("Federation media types are still recognized on other paths", () => {
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
