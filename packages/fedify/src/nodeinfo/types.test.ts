import { assertEquals, assertThrows } from "@std/assert";
import { test } from "../testing/mod.ts";
import { type NodeInfo, nodeInfoToJson } from "./types.ts";

test("nodeInfoToJson()", () => {
  const validInfo: NodeInfo = {
    software: {
      name: "software-name",
      version: { major: 1, minor: 2, patch: 3 },
    },
    protocols: ["activitypub"],
    usage: {
      users: { total: 100, activeHalfyear: 50, activeMonth: 10 },
      localPosts: 1000,
      localComments: 10000,
    },
  };
  assertEquals(
    nodeInfoToJson(validInfo),
    {
      "$schema": "http://nodeinfo.diaspora.software/ns/schema/2.1#",
      version: "2.1",
      software: {
        name: "software-name",
        version: "1.2.3",
        repository: undefined,
        homepage: undefined,
      },
      protocols: ["activitypub"],
      services: { inbound: [], outbound: [] },
      openRegistrations: false,
      usage: {
        localComments: 10000,
        localPosts: 1000,
        users: { activeHalfyear: 50, activeMonth: 10, total: 100 },
      },
      metadata: {},
    },
  );
  assertEquals(
    nodeInfoToJson({
      ...validInfo,
      software: {
        ...validInfo.software,
        repository: new URL("https://example.com/repo"),
        homepage: new URL("https://example.com/home"),
      },
      services: {
        inbound: ["atom1.0", "imap"],
        outbound: ["atom1.0", "smtp"],
      },
      openRegistrations: true,
    }),
    {
      "$schema": "http://nodeinfo.diaspora.software/ns/schema/2.1#",
      version: "2.1",
      software: {
        name: "software-name",
        version: "1.2.3",
        repository: "https://example.com/repo",
        homepage: "https://example.com/home",
      },
      protocols: ["activitypub"],
      services: {
        inbound: ["atom1.0", "imap"],
        outbound: ["atom1.0", "smtp"],
      },
      openRegistrations: true,
      usage: {
        localComments: 10000,
        localPosts: 1000,
        users: { activeHalfyear: 50, activeMonth: 10, total: 100 },
      },
      metadata: {},
    },
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        software: { ...validInfo.software, name: "INVALID-NAME" },
      }),
    TypeError,
    "Invalid software name",
  );
  assertThrows(
    () => nodeInfoToJson({ ...validInfo, protocols: [] }),
    TypeError,
    "At least one protocol must be supported",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: {
          ...validInfo.usage,
          users: { ...validInfo.usage.users, total: -1 },
        },
      }),
    TypeError,
    "Invalid total users",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: {
          ...validInfo.usage,
          users: { ...validInfo.usage.users, total: 1.23 },
        },
      }),
    TypeError,
    "Invalid total users",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: {
          ...validInfo.usage,
          users: { ...validInfo.usage.users, activeHalfyear: -1 },
        },
      }),
    TypeError,
    "Invalid active halfyear users",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: {
          ...validInfo.usage,
          users: { ...validInfo.usage.users, activeHalfyear: 1.23 },
        },
      }),
    TypeError,
    "Invalid active halfyear users",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: {
          ...validInfo.usage,
          users: { ...validInfo.usage.users, activeMonth: -1 },
        },
      }),
    TypeError,
    "Invalid active month users",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: {
          ...validInfo.usage,
          users: { ...validInfo.usage.users, activeMonth: 1.23 },
        },
      }),
    TypeError,
    "Invalid active month users",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: { ...validInfo.usage, localPosts: -1 },
      }),
    TypeError,
    "Invalid local posts",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: { ...validInfo.usage, localPosts: 1.23 },
      }),
    TypeError,
    "Invalid local posts",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: { ...validInfo.usage, localComments: -1 },
      }),
    TypeError,
    "Invalid local comments",
  );
  assertThrows(
    () =>
      nodeInfoToJson({
        ...validInfo,
        usage: { ...validInfo.usage, localComments: 1.23 },
      }),
    TypeError,
    "Invalid local comments",
  );
});
