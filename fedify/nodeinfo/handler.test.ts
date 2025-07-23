import { assertEquals } from "@std/assert";
import type { NodeInfoDispatcher } from "../federation/callback.ts";
import { MemoryKvStore } from "../federation/kv.ts";
import { createFederation } from "../federation/middleware.ts";
import { createRequestContext } from "../testing/mod.ts";
import { test } from "../testing/mod.ts";
import { handleNodeInfo, handleNodeInfoJrd } from "./handler.ts";
import { parseSemVer } from "./semver.ts";

test("handleNodeInfo()", async () => {
  const request = new Request("https://example.com/nodeinfo/2.1");
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  const context = createRequestContext<void>({
    federation,
    data: undefined,
    request,
    url: new URL(request.url),
  });
  const nodeInfoDispatcher: NodeInfoDispatcher<void> = (_ctx) => ({
    software: {
      name: "test",
      version: parseSemVer("1.2.3"),
    },
    protocols: ["activitypub"],
    usage: {
      users: { total: 3, activeHalfyear: 2, activeMonth: 1 },
      localPosts: 123,
      localComments: 456,
    },
  });
  const response = await handleNodeInfo(request, {
    context,
    nodeInfoDispatcher,
  });
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/json;" +
      ' profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"',
  );
  const json = await response.json();
  assertEquals(json, {
    "$schema": "http://nodeinfo.diaspora.software/ns/schema/2.1#",
    version: "2.1",
    software: {
      name: "test",
      version: "1.2.3",
    },
    protocols: ["activitypub"],
    services: {
      inbound: [],
      outbound: [],
    },
    openRegistrations: false,
    usage: {
      users: { total: 3, activeHalfyear: 2, activeMonth: 1 },
      localPosts: 123,
      localComments: 456,
    },
    metadata: {},
  });
});

test("handleNodeInfoJrd()", async () => {
  const request = new Request("https://example.com/.well-known/nodeinfo");
  const federation = createFederation<void>({ kv: new MemoryKvStore() });
  let context = createRequestContext<void>({
    federation,
    data: undefined,
    request,
    url: new URL(request.url),
  });
  let response = await handleNodeInfoJrd(request, context);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "application/jrd+json");
  assertEquals(await response.json(), { links: [] });

  context = createRequestContext<void>({
    ...context,
    getNodeInfoUri() {
      return new URL("https://example.com/nodeinfo/2.1");
    },
  });
  response = await handleNodeInfoJrd(request, context);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "application/jrd+json");
  assertEquals(await response.json(), {
    links: [
      {
        href: "https://example.com/nodeinfo/2.1",
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
        type: "application/json;" +
          ' profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"',
      },
    ],
  });
});
