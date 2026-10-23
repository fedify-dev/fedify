import { test } from "@fedify/fixture";
import { UrlError } from "@fedify/vocab-runtime";
import {
  openDirectFetch,
  openPublicFetch,
  type PublicFetchSession,
} from "@fedify/vocab-runtime/internal";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { assertEquals, assertInstanceOf } from "@std/assert";
import fetchMock from "fetch-mock";
import {
  getNodeInfo,
  getNodeInfoInternal,
  type GetNodeInfoOptions,
  parseInboundService,
  parseNodeInfo,
  parseOutboundService,
  parseProtocol,
  parseServices,
  parseSoftware,
  parseUsage,
} from "./client.ts";
import type {
  InboundService,
  JsonValue,
  NodeInfo,
  OutboundService,
  Protocol,
} from "./types.ts";

// fetch-mock routes match hostnames, but on runtimes that pin connections
// the request URL has the resolved IP address instead.  Tests of the response
// handling therefore skip address validation, and tests of the address policy
// let only example.com through without it:
function getNodeInfoDirect(
  url: URL | string,
  options?: GetNodeInfoOptions,
): Promise<NodeInfo | JsonValue | undefined> {
  return getNodeInfoInternal(url, options, { openHop: openDirectFetch });
}

function getNodeInfoValidated(
  url: URL | string,
  options?: GetNodeInfoOptions,
): Promise<NodeInfo | JsonValue | undefined> {
  return getNodeInfoInternal(url, options, {
    openHop: (hopUrl) =>
      new URL(hopUrl).hostname === "example.com"
        ? openDirectFetch(hopUrl)
        : openPublicFetch(hopUrl, {
          lookup: () =>
            Promise.resolve([{ address: "93.184.215.14", family: 4 }]),
        }),
  });
}

test("getNodeInfo()", async (t) => {
  fetchMock.spyGlobal();

  fetchMock.get("https://example.com/.well-known/nodeinfo", {
    body: {
      links: [
        {
          rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
          href: "https://example.com/nodeinfo/2.1",
        },
      ],
    },
  });

  const rawExpected = {
    software: { name: "foo", version: "1.2.3" },
    protocols: ["activitypub", "diaspora"],
    usage: { users: {}, localPosts: 123, localComments: 456 },
  };

  fetchMock.get("https://example.com/nodeinfo/2.1", { body: rawExpected });
  fetchMock.get("https://example.com/404", { status: 404 });

  const expected: NodeInfo = {
    software: {
      name: "foo",
      version: "1.2.3",
    },
    protocols: ["activitypub", "diaspora"],
    usage: { users: {}, localPosts: 123, localComments: 456 },
  };

  await t.step("indirect", async () => {
    const info = await getNodeInfoDirect("https://example.com/");
    assertEquals(info, expected);

    const raw = await getNodeInfoDirect("https://example.com/", {
      parse: "none",
    });
    assertEquals(raw, rawExpected);
  });

  await t.step("direct", async () => {
    const info = await getNodeInfoDirect(
      "https://example.com/nodeinfo/2.1",
      { direct: true },
    );
    assertEquals(info, expected);
  });

  fetchMock.removeRoutes();
  fetchMock.get("https://example.com/.well-known/nodeinfo", {
    body: { links: [] },
  });

  await t.step("indirect: no links", async () => {
    const info = await getNodeInfoDirect("https://example.com/");
    assertEquals(info, undefined);
  });

  fetchMock.removeRoutes();
  fetchMock.get("https://example.com/.well-known/nodeinfo", {
    status: 404,
  });

  await t.step("indirect: 404", async () => {
    const info = await getNodeInfoDirect("https://example.com/");
    assertEquals(info, undefined);
  });

  await t.step("direct: 404", async () => {
    const info = await getNodeInfoDirect(
      "https://example.com/nodeinfo/2.0",
      { direct: true },
    );
    assertEquals(info, undefined);
    const info2 = await getNodeInfoDirect(
      "https://example.com/404",
      { direct: true },
    );
    assertEquals(info2, undefined);
  });

  fetchMock.hardReset();
});

test("getNodeInfo() blocks SSRF", async (t) => {
  fetchMock.spyGlobal();

  await t.step("link href pointing to a loopback address", async () => {
    fetchMock.removeRoutes();
    fetchMock.get("https://example.com/.well-known/nodeinfo", {
      body: {
        links: [
          {
            rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
            href: "http://127.0.0.1:8080/internal",
          },
        ],
      },
    });
    let internalFetched = false;
    fetchMock.get("http://127.0.0.1:8080/internal", () => {
      internalFetched = true;
      return { body: { secret: "INTERNAL_DATA_LEAKED" } };
    });

    const info = await getNodeInfoValidated("https://example.com/", {
      parse: "none",
    });
    assertEquals(info, undefined);
    assertEquals(internalFetched, false);
  });

  await t.step("link href using a data: URL", async () => {
    fetchMock.removeRoutes();
    fetchMock.get("https://example.com/.well-known/nodeinfo", {
      body: {
        links: [
          {
            rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
            href: 'data:application/json,{"software":{"name":"x"}}',
          },
        ],
      },
    });

    const info = await getNodeInfoValidated("https://example.com/", {
      parse: "none",
    });
    assertEquals(info, undefined);
  });

  await t.step("redirect to a private address", async () => {
    fetchMock.removeRoutes();
    fetchMock.get("https://example.com/.well-known/nodeinfo", {
      body: {
        links: [
          {
            rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
            href: "https://example.com/nodeinfo/2.1",
          },
        ],
      },
    });
    fetchMock.get("https://example.com/nodeinfo/2.1", {
      status: 302,
      headers: { Location: "https://127.0.0.1:8080/internal" },
    });
    let internalFetched = false;
    fetchMock.get("https://127.0.0.1:8080/internal", () => {
      internalFetched = true;
      return { body: { secret: "INTERNAL_DATA_LEAKED" } };
    });

    const info = await getNodeInfoValidated("https://example.com/", {
      parse: "none",
    });
    assertEquals(info, undefined);
    assertEquals(internalFetched, false);
  });

  await t.step("direct fetch of a private address", async () => {
    fetchMock.removeRoutes();
    let internalFetched = false;
    fetchMock.get("http://127.0.0.1:8080/nodeinfo", () => {
      internalFetched = true;
      return { body: { software: { name: "x", version: "1.0.0" } } };
    });

    const info = await getNodeInfoValidated("http://127.0.0.1:8080/nodeinfo", {
      direct: true,
      parse: "none",
    });
    assertEquals(info, undefined);
    assertEquals(internalFetched, false);
  });

  fetchMock.hardReset();
});

test("parseNodeInfo()", () => {
  const input = {
    software: {
      name: "foo",
      version: "1.2.3",
      repository: "https://codeberg.org/foo/foo",
      homepage: "https://foo.example",
    },
    protocols: ["activitypub", "diaspora"],
    services: {
      inbound: ["atom1.0", "pop3", "twitter"],
      outbound: ["atom1.0", "diaspora", "facebook"],
    },
    openRegistrations: true,
    usage: {
      users: { activeHalfyear: 10, activeMonth: 20, total: 30 },
      localPosts: 123,
      localComments: 456,
    },
    metadata: { foo: 123, bar: "456" },
  };
  const output: NodeInfo = {
    software: {
      name: "foo",
      version: "1.2.3",
      repository: new URL("https://codeberg.org/foo/foo"),
      homepage: new URL("https://foo.example"),
    },
    protocols: ["activitypub", "diaspora"],
    services: {
      inbound: ["atom1.0", "pop3", "twitter"],
      outbound: ["atom1.0", "diaspora", "facebook"],
    },
    openRegistrations: true,
    usage: {
      users: { activeHalfyear: 10, activeMonth: 20, total: 30 },
      localPosts: 123,
      localComments: 456,
    },
    metadata: { foo: 123, bar: "456" },
  };
  assertEquals(parseNodeInfo(123), null);
  assertEquals(parseNodeInfo(123, { tryBestEffort: true }), null);
  assertEquals(parseNodeInfo(input), output);
  assertEquals(
    parseNodeInfo({ ...input, software: { name: " FOO ", version: "1.2.3" } }),
    null,
  );
  assertEquals(
    parseNodeInfo(
      { ...input, software: { name: " FOO ", version: "1.2.3" } },
      { tryBestEffort: true },
    ),
    {
      ...output,
      software: {
        name: output.software.name,
        version: output.software.version,
      },
    },
  );
  assertEquals(parseNodeInfo({ ...input, protocols: 123 }), null);
  assertEquals(
    parseNodeInfo({ ...input, protocols: 123 }, { tryBestEffort: true }),
    { ...output, protocols: [] },
  );
  assertEquals(
    parseNodeInfo({ ...input, protocols: ["activitypub", "foo"] }),
    null,
  );
  assertEquals(
    parseNodeInfo(
      { ...input, protocols: ["activitypub", "foo"] },
      { tryBestEffort: true },
    ),
    { ...output, protocols: ["activitypub"] },
  );
  assertEquals(parseNodeInfo({ ...input, services: 123 }), null);
  assertEquals(
    parseNodeInfo({ ...input, services: 123 }, { tryBestEffort: true }),
    {
      software: output.software,
      protocols: output.protocols,
      openRegistrations: output.openRegistrations,
      usage: output.usage,
      metadata: output.metadata,
    },
  );
  assertEquals(
    parseNodeInfo({ ...input, services: { inbound: ["atom1.0", "foo"] } }),
    null,
  );
  assertEquals(
    parseNodeInfo(
      { ...input, services: { inbound: ["atom1.0", "foo"] } },
      { tryBestEffort: true },
    ),
    {
      software: output.software,
      protocols: output.protocols,
      services: { inbound: ["atom1.0"] },
      openRegistrations: output.openRegistrations,
      usage: output.usage,
      metadata: output.metadata,
    },
  );
  assertEquals(
    parseNodeInfo({ ...input, openRegistrations: 123 }),
    null,
  );
  assertEquals(
    parseNodeInfo(
      { ...input, openRegistrations: 123 },
      { tryBestEffort: true },
    ),
    {
      software: output.software,
      protocols: output.protocols,
      services: output.services,
      usage: output.usage,
      metadata: output.metadata,
    },
  );
  assertEquals(
    parseNodeInfo({ ...input, usage: 123 }),
    null,
  );
  assertEquals(
    parseNodeInfo({ ...input, usage: 123 }, { tryBestEffort: true }),
    {
      software: output.software,
      protocols: output.protocols,
      services: output.services,
      openRegistrations: output.openRegistrations,
      usage: { users: {}, localPosts: 0, localComments: 0 },
      metadata: output.metadata,
    },
  );
  assertEquals(
    parseNodeInfo({ ...input, metadata: 123 }),
    null,
  );
  assertEquals(
    parseNodeInfo({ ...input, metadata: 123 }, { tryBestEffort: true }),
    {
      software: output.software,
      protocols: output.protocols,
      services: output.services,
      openRegistrations: output.openRegistrations,
      usage: output.usage,
    },
  );
});

test("parseSoftware()", () => {
  assertEquals(
    parseSoftware({
      name: "foo",
      version: "1.2.3",
      repository: "https://codeberg.org/foo/foo",
      homepage: "https://foo.example",
    }),
    {
      name: "foo",
      version: "1.2.3",
      repository: new URL("https://codeberg.org/foo/foo"),
      homepage: new URL("https://foo.example"),
    },
  );
  assertEquals(
    parseSoftware({
      name: "foo",
      version: "4.5.6-beta.7+build.8",
    }),
    {
      name: "foo",
      version: "4.5.6-beta.7+build.8",
    },
  );
  assertEquals(parseSoftware(123), null);
  assertEquals(parseSoftware(123, { tryBestEffort: true }), null);
  assertEquals(parseSoftware({ name: 123 }), null);
  assertEquals(parseSoftware({ name: 123 }, { tryBestEffort: true }), null);
  assertEquals(parseSoftware({ name: "" }), null);
  assertEquals(parseSoftware({ name: "" }, { tryBestEffort: true }), null);
  assertEquals(parseSoftware({ name: " FOO " }), null);
  assertEquals(
    parseSoftware({ name: " FOO " }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "0.0.0",
    },
  );
  assertEquals(parseSoftware({ name: "foo", version: 123 }), {
    name: "foo",
    version: "123",
  });
  assertEquals(
    parseSoftware({ name: "foo", version: 123 }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "123",
    },
  );
  assertEquals(parseSoftware({ name: "foo", version: "abc" }), {
    name: "foo",
    version: "abc",
  });
  assertEquals(
    parseSoftware({ name: "foo", version: "abc" }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "abc",
    },
  );
  assertEquals(
    parseSoftware({ name: "foo", version: " 1.2.3 " }),
    {
      name: "foo",
      version: " 1.2.3 ",
    },
  );
  assertEquals(
    parseSoftware({ name: "foo", version: " 1.2.3 " }, { tryBestEffort: true }),
    {
      name: "foo",
      version: " 1.2.3 ",
    },
  );
  assertEquals(
    parseSoftware({ name: "foo", version: "1.2.3", repository: 123 }),
    null,
  );
  assertEquals(
    parseSoftware({ name: "foo", version: "1.2.3", homepage: 456 }),
    null,
  );
  assertEquals(
    parseSoftware({
      name: "foo",
      version: "1.2.3",
      repository: 123,
      homepage: 456,
    }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "1.2.3",
    },
  );
  assertEquals(
    parseSoftware({ name: "foo", version: "1.2.3", repository: "" }),
    null,
  );
  assertEquals(
    parseSoftware({ name: "foo", version: "1.2.3", homepage: "" }),
    null,
  );
  assertEquals(
    parseSoftware({
      name: "foo",
      version: "1.2.3",
      repository: "",
      homepage: "",
    }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "1.2.3",
    },
  );
  assertEquals(
    parseSoftware({
      name: "foo",
      version: "2.81",
      repository: "",
      homepage: "",
    }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "2.81",
    },
  );
  assertEquals(
    parseSoftware({
      name: "foo",
      version: "3",
      repository: "",
      homepage: "",
    }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "3",
    },
  );
  assertEquals(
    parseSoftware({
      name: "foo",
      version: "2.1.3.4",
      repository: "",
      homepage: "",
    }, { tryBestEffort: true }),
    {
      name: "foo",
      version: "2.1.3.4",
    },
  );
});

test("parseProtocol()", () => {
  // deno-fmt-ignore
  const protocols: Protocol[] = [
    // cSpell: disable
    "activitypub", "buddycloud", "dfrn", "diaspora", "libertree", "ostatus",
    "pumpio", "tent", "xmpp", "zot",
    // cSpell: enable
  ];
  for (const protocol of protocols) {
    assertEquals(parseProtocol(protocol), protocol);
  }
  assertEquals(parseProtocol("foo"), null);
});

test("parseServices()", () => {
  assertEquals(
    parseServices({
      inbound: ["atom1.0", "pop3", "twitter"],
      outbound: ["atom1.0", "diaspora", "facebook"],
    }),
    {
      inbound: ["atom1.0", "pop3", "twitter"],
      outbound: ["atom1.0", "diaspora", "facebook"],
    },
  );
  assertEquals(
    parseServices({ inbound: ["atom1.0", "pop3", "twitter"] }),
    { inbound: ["atom1.0", "pop3", "twitter"] },
  );
  assertEquals(
    parseServices({ outbound: ["atom1.0", "diaspora", "facebook"] }),
    { outbound: ["atom1.0", "diaspora", "facebook"] },
  );
  assertEquals(parseServices({}), {});
  assertEquals(parseServices(123), null);
  assertEquals(parseServices(123, { tryBestEffort: true }), {});
  assertEquals(
    parseServices({
      inbound: ["atom1.0", "pop3", "twitter", "foo"],
      outbound: ["atom1.0", "diaspora", "facebook"],
    }),
    null,
  );
  assertEquals(
    parseServices({
      inbound: ["atom1.0", "pop3", "twitter"],
      outbound: ["atom1.0", "diaspora", "facebook", "bar"],
    }),
    null,
  );
  assertEquals(
    parseServices({
      inbound: ["atom1.0", "pop3", "twitter", "foo"],
      outbound: ["atom1.0", "diaspora", "facebook", "bar"],
    }, { tryBestEffort: true }),
    {
      inbound: ["atom1.0", "pop3", "twitter"],
      outbound: ["atom1.0", "diaspora", "facebook"],
    },
  );
});

test("parseInboundService()", () => {
  // deno-fmt-ignore
  const services: InboundService[] = [
    // cSpell: disable
    "atom1.0", "gnusocial", "imap", "pnut", "pop3", "pumpio", "rss2.0",
    "twitter"
    // cSpell: enable
  ];
  for (const service of services) {
    assertEquals(parseInboundService(service), service);
  }
  assertEquals(parseInboundService("foo"), null);
});

test("parseOutboundService()", () => {
  // deno-fmt-ignore
  const services: OutboundService[] = [
    // cSpell: disable
    "atom1.0", "blogger", "buddycloud", "diaspora", "dreamwidth", "drupal",
    "facebook", "friendica", "gnusocial", "google", "insanejournal",
    "libertree", "linkedin", "livejournal", "mediagoblin", "myspace",
    "pinterest", "pnut", "posterous", "pumpio", "redmatrix", "rss2.0", "smtp",
    "tent", "tumblr", "twitter", "wordpress", "xmpp",
    // cSpell: enable
  ];
  for (const service of services) {
    assertEquals(parseOutboundService(service), service);
  }
  assertEquals(parseOutboundService("foo"), null);
});

test("parseUsage()", () => {
  assertEquals(
    parseUsage({ users: {}, localPosts: 123, localComments: 456 }),
    {
      users: {},
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }),
    {
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(parseUsage(123), null);
  assertEquals(parseUsage(123, { tryBestEffort: true }), null);
  assertEquals(
    parseUsage({ users: {}, localPosts: "123", localComments: 456 }),
    null,
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: "123", localComments: 456 }, {
      tryBestEffort: true,
    }),
    {
      users: {},
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: "", localComments: 456 }),
    null,
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: "", localComments: 456 }, {
      tryBestEffort: true,
    }),
    {
      users: {},
      localPosts: 0,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: [], localComments: 456 }),
    null,
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: [], localComments: 456 }, {
      tryBestEffort: true,
    }),
    {
      users: {},
      localPosts: 0,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: 123, localComments: "456" }),
    null,
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: 123, localComments: "456" }, {
      tryBestEffort: true,
    }),
    {
      users: {},
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: 123, localComments: "" }),
    null,
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: 123, localComments: "" }, {
      tryBestEffort: true,
    }),
    {
      users: {},
      localPosts: 123,
      localComments: 0,
    },
  );
  assertEquals(
    parseUsage({ users: null, localPosts: 123, localComments: [] }),
    null,
  );
  assertEquals(
    parseUsage({ users: null, localPosts: 123, localComments: "" }, {
      tryBestEffort: true,
    }),
    {
      users: {},
      localPosts: 123,
      localComments: 0,
    },
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: 123, localComments: [] }),
    null,
  );
  assertEquals(
    parseUsage({ users: {}, localPosts: 123, localComments: [] }, {
      tryBestEffort: true,
    }),
    {
      users: {},
      localPosts: 123,
      localComments: 0,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: "10",
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: "10",
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: "",
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: "",
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: [],
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: [],
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: "20",
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: "20",
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: "",
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: "",
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeHalfyear: 10,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: [],
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: [],
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeHalfyear: 10,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: "30",
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: "30",
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: 30,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: "",
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: "",
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: [],
      },
      localPosts: 123,
      localComments: 456,
    }),
    null,
  );
  assertEquals(
    parseUsage({
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
        total: [],
      },
      localPosts: 123,
      localComments: 456,
    }, { tryBestEffort: true }),
    {
      users: {
        activeHalfyear: 10,
        activeMonth: 20,
      },
      localPosts: 123,
      localComments: 456,
    },
  );
});

test("getNodeInfo() bounds both discovery and document responses", async () => {
  fetchMock.mockGlobal();
  const base = "https://8.8.8.8";
  const descriptor = {
    links: [{
      rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
      href: `${base}/nodeinfo`,
    }],
  };
  let oversizedDescriptor = true;
  let oversizedDocument = true;
  const data = { padding: "a".repeat(256) };
  try {
    fetchMock.get(
      `${base}/.well-known/nodeinfo`,
      () =>
        new Response(JSON.stringify(descriptor), {
          headers: oversizedDescriptor
            ? { "Content-Length": String(16 * 1024 * 1024 + 1) }
            : {},
        }),
    );
    fetchMock.get(
      `${base}/nodeinfo`,
      () =>
        new Response(JSON.stringify(data), {
          headers: oversizedDocument
            ? { "Content-Length": String(16 * 1024 * 1024 + 1) }
            : {},
        }),
    );
    assertEquals(await getNodeInfo(base), undefined);
    assertEquals(fetchMock.callHistory.calls(`${base}/nodeinfo`).length, 0);
    oversizedDescriptor = false;
    assertEquals(await getNodeInfo(base), undefined);
    assertEquals(
      await getNodeInfo(`${base}/nodeinfo`, {
        direct: true,
        parse: "none",
      }),
      undefined,
    );
    oversizedDocument = false;
    assertEquals(
      await getNodeInfo(base, {
        parse: "none",
      }),
      data,
    );
  } finally {
    fetchMock.hardReset();
  }
});

test("getNodeInfo() logs DNS failures as such", async (t) => {
  for (const result of ["throws", "empty", "private"] as const) {
    await t.step(result, async () => {
      const lookup = () =>
        result === "throws"
          ? Promise.reject(new Error("Resolver unavailable"))
          : Promise.resolve(
            result === "empty" ? [] : [{ address: "127.0.0.1", family: 4 }],
          );
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
        assertEquals(
          await getNodeInfoInternal("https://dns-failure.invalid/", {}, {
            openHop: (url) => openPublicFetch(url, { lookup }),
          }),
          undefined,
        );
        const url = "https://dns-failure.invalid/.well-known/nodeinfo";
        assertEquals(
          records.map((r) => [r.level, r.rawMessage, r.properties.url]),
          [[
            "error",
            result === "private"
              ? "Refused to fetch a private or invalid URL {url}: {error}"
              : "DNS lookup failed for {url}: {error}",
            url,
          ]],
        );
        const { error } = records[0].properties;
        assertInstanceOf(error, UrlError);
        assertEquals(error.reason, result === "private" ? "disallowed" : "dns");
      } finally {
        await reset();
      }
    });
  }
});

interface FakeResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  /** The `url` of the response, as a pinned fetch reports it. */
  readonly url?: string;
  /** Makes cancelling the body fail. */
  readonly cancelFails?: boolean;
  /** Makes cancelling the body never settle. */
  readonly cancelNeverSettles?: boolean;
}

interface HopRecorder {
  readonly events: string[];
  readonly openHop: (url: string) => Promise<PublicFetchSession>;
  /**
   * Asserts that every opened session is closed, and that every response
   * body was consumed or cancelled before its session was closed.
   */
  assertInvariants(): void;
}

// A fake server that records the lifecycle of each session and response.
// Unlike real sessions, closing a fake session never cancels bodies, so that
// the caller's own cleanup is observed:
function recordHops(respond: (url: URL) => FakeResponse): HopRecorder {
  const events: string[] = [];
  const unsettled: string[] = [];
  let opens = 0;
  let closes = 0;
  let responses = 0;
  return {
    events,
    // deno-lint-ignore require-await
    async openHop(url) {
      opens++;
      events.push(`open ${url}`);
      const states: { id: number; settled: boolean }[] = [];
      let closed = false;
      return {
        url: new URL(url),
        // deno-lint-ignore require-await
        async fetch(input) {
          if (closed) throw new TypeError("The fetch session is closed.");
          const target = new URL(input instanceof Request ? input.url : input);
          const id = ++responses;
          events.push(`fetch ${target.href} #${id}`);
          const fake = respond(target);
          const state = { id, settled: false };
          states.push(state);
          let sent = false;
          const body = new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent && fake.body != null && fake.body !== "") {
                sent = true;
                controller.enqueue(new TextEncoder().encode(fake.body));
                return;
              }
              state.settled = true;
              events.push(`consumed #${id}`);
              controller.close();
            },
            cancel() {
              state.settled = true;
              events.push(`cancel #${id}`);
              if (fake.cancelFails) throw new Error("Cancellation failed");
              if (fake.cancelNeverSettles) return new Promise(() => {});
            },
          }, { highWaterMark: 0 });
          const response = new Response(body, {
            status: fake.status ?? 200,
            headers: fake.headers,
          });
          if (fake.url != null) {
            Object.defineProperty(response, "url", { value: fake.url });
          }
          return response;
        },
        // deno-lint-ignore require-await
        async close() {
          if (closed) return;
          closed = true;
          closes++;
          for (const state of states) {
            if (!state.settled) unsettled.push(`#${state.id}`);
          }
          events.push(`close ${url}`);
        },
      };
    },
    assertInvariants() {
      assertEquals(closes, opens);
      assertEquals(unsettled, []);
    },
  };
}

test("getNodeInfo() closes each hop after cleaning up its body", async (t) => {
  const wellKnown = "https://example.com/.well-known/nodeinfo";
  const wellKnown2 = "https://example.com/.well-known/nodeinfo2";
  const documentUrl = "https://example.com/nodeinfo/2.1";
  const rawDocument = {
    software: { name: "foo", version: "1.2.3" },
    protocols: ["activitypub"],
    usage: { users: {}, localPosts: 0, localComments: 0 },
  };
  const descriptor = JSON.stringify({
    links: [{
      rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
      href: documentUrl,
    }],
  });

  await t.step("redirect", async () => {
    const recorder = recordHops((url) => {
      switch (url.href) {
        case wellKnown:
          return {
            status: 302,
            headers: { Location: "/.well-known/nodeinfo2" },
            body: "redirecting",
            // A pinned response's url has the IP address, which must not be
            // used as the base of the Location:
            url: "https://93.184.215.14/.well-known/nodeinfo",
          };
        case wellKnown2:
          return { body: descriptor };
        default:
          return { body: JSON.stringify(rawDocument) };
      }
    });
    assertEquals(
      await getNodeInfoInternal("https://example.com/", { parse: "none" }, {
        openHop: recorder.openHop,
      }),
      rawDocument,
    );
    assertEquals(recorder.events, [
      `open ${wellKnown}`,
      `fetch ${wellKnown} #1`,
      "cancel #1",
      `close ${wellKnown}`,
      `open ${wellKnown2}`,
      `fetch ${wellKnown2} #2`,
      "consumed #2",
      `close ${wellKnown2}`,
      `open ${documentUrl}`,
      `fetch ${documentUrl} #3`,
      "consumed #3",
      `close ${documentUrl}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("non-2xx responses", async () => {
    const recorder = recordHops(() => ({ status: 404, body: "not found" }));
    assertEquals(
      await getNodeInfoInternal("https://example.com/", {}, {
        openHop: recorder.openHop,
      }),
      undefined,
    );
    assertEquals(
      await getNodeInfoInternal(documentUrl, { direct: true }, {
        openHop: recorder.openHop,
      }),
      undefined,
    );
    assertEquals(recorder.events, [
      `open ${wellKnown}`,
      `fetch ${wellKnown} #1`,
      "cancel #1",
      `close ${wellKnown}`,
      `open ${documentUrl}`,
      `fetch ${documentUrl} #2`,
      "cancel #2",
      `close ${documentUrl}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("too many redirections", async () => {
    const recorder = recordHops(() => ({
      status: 302,
      headers: { Location: "/.well-known/nodeinfo" },
      body: "redirecting",
    }));
    assertEquals(
      await getNodeInfoInternal("https://example.com/", {}, {
        openHop: recorder.openHop,
      }),
      undefined,
    );
    assertEquals(
      recorder.events.filter((e) => e.startsWith("open ")).length,
      5,
    );
    assertEquals(
      recorder.events.filter((e) => e.startsWith("cancel ")).length,
      5,
    );
    recorder.assertInvariants();
  });

  await t.step("failed redirect body cancellation", async () => {
    const recorder = recordHops((url) => {
      switch (url.href) {
        case wellKnown:
          return {
            status: 302,
            headers: { Location: "/.well-known/nodeinfo2" },
            body: "redirecting",
            cancelFails: true,
          };
        case wellKnown2:
          return { body: descriptor };
        default:
          return { status: 404, body: "not found", cancelFails: true };
      }
    });
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
      assertEquals(
        await getNodeInfoInternal("https://example.com/", {}, {
          openHop: recorder.openHop,
        }),
        undefined,
      );
      const failures = records.filter((r) =>
        r.rawMessage ===
          "Failed to cancel the response body from {url}: {error}"
      );
      assertEquals(
        failures.map((r) => [r.level, r.properties.url]),
        [["debug", wellKnown], ["debug", documentUrl]],
      );
      for (const { properties: { error } } of failures) {
        assertInstanceOf(error, Error);
        assertEquals(error.message, "Cancellation failed");
      }
    } finally {
      await reset();
    }
    assertEquals(recorder.events, [
      `open ${wellKnown}`,
      `fetch ${wellKnown} #1`,
      "cancel #1",
      `close ${wellKnown}`,
      `open ${wellKnown2}`,
      `fetch ${wellKnown2} #2`,
      "consumed #2",
      `close ${wellKnown2}`,
      `open ${documentUrl}`,
      `fetch ${documentUrl} #3`,
      "cancel #3",
      `close ${documentUrl}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("never-settling body cancellation", async () => {
    const recorder = recordHops((url) => {
      switch (url.href) {
        case wellKnown:
          return {
            status: 302,
            headers: { Location: "/.well-known/nodeinfo2" },
            body: "redirecting",
            cancelNeverSettles: true,
          };
        case wellKnown2:
          return { body: descriptor };
        default:
          return { status: 404, body: "not found", cancelNeverSettles: true };
      }
    });
    assertEquals(
      await settleWithin(
        getNodeInfoInternal("https://example.com/", {}, {
          openHop: recorder.openHop,
        }),
      ),
      undefined,
    );
    assertEquals(recorder.events, [
      `open ${wellKnown}`,
      `fetch ${wellKnown} #1`,
      "cancel #1",
      `close ${wellKnown}`,
      `open ${wellKnown2}`,
      `fetch ${wellKnown2} #2`,
      "consumed #2",
      `close ${wellKnown2}`,
      `open ${documentUrl}`,
      `fetch ${documentUrl} #3`,
      "cancel #3",
      `close ${documentUrl}`,
    ]);
    recorder.assertInvariants();
  });

  await t.step("failure while consuming", async () => {
    const recorder = recordHops(() => ({ body: "not json" }));
    assertEquals(
      await getNodeInfoInternal("https://example.com/", {}, {
        openHop: recorder.openHop,
      }),
      undefined,
    );
    assertEquals(recorder.events, [
      `open ${wellKnown}`,
      `fetch ${wellKnown} #1`,
      "consumed #1",
      `close ${wellKnown}`,
    ]);
    recorder.assertInvariants();
  });
});

/**
 * Rejects if the given promise does not settle within the timeout, so that
 * a hang fails the test instead of blocking it.
 */
async function settleWithin<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not settle within ${ms} ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A body that a real session cannot cancel to completion: fetch-mock returns
// a clone (a tee) of a Response instance, and the cancellation of a branch of
// a tee settles only after the other branch is cancelled too.  Its source's
// cancel callback never settles either:
function neverCancellableResponse(init: ResponseInit): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("never cancelled"));
      },
      cancel: () => new Promise(() => {}),
    }),
    init,
  );
}

test("getNodeInfo() does not wait for cancelling response bodies", async (t) => {
  const rawDocument = {
    software: { name: "foo", version: "1.2.3" },
    protocols: ["activitypub"],
    usage: { users: {}, localPosts: 0, localComments: 0 },
  };
  fetchMock.mockGlobal();
  try {
    await t.step("redirect", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "https://example.com/.well-known/nodeinfo",
        () =>
          neverCancellableResponse({
            status: 302,
            headers: { Location: "/.well-known/nodeinfo2" },
          }),
      );
      fetchMock.get(
        "https://example.com/.well-known/nodeinfo2",
        () =>
          Response.json({
            links: [{
              rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
              href: "https://example.com/nodeinfo/2.1",
            }],
          }),
      );
      fetchMock.get(
        "https://example.com/nodeinfo/2.1",
        () => Response.json(rawDocument),
      );
      assertEquals(
        await settleWithin(
          getNodeInfoDirect("https://example.com/", { parse: "none" }),
        ),
        rawDocument,
      );
    });

    await t.step("non-2xx responses", async () => {
      fetchMock.removeRoutes();
      fetchMock.get(
        "https://example.com/.well-known/nodeinfo",
        () => neverCancellableResponse({ status: 404 }),
      );
      fetchMock.get(
        "https://example.com/nodeinfo/2.1",
        () => neverCancellableResponse({ status: 404 }),
      );
      assertEquals(
        await settleWithin(getNodeInfoDirect("https://example.com/")),
        undefined,
      );
      assertEquals(
        await settleWithin(
          getNodeInfoDirect("https://example.com/nodeinfo/2.1", {
            direct: true,
          }),
        ),
        undefined,
      );
    });
  } finally {
    fetchMock.hardReset();
  }
});
