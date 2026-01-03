import { test } from "@fedify/fixture";
import { assertEquals } from "@std/assert";
import fetchMock from "fetch-mock";
import {
  getNodeInfo,
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
  NodeInfo,
  OutboundService,
  Protocol,
} from "./types.ts";

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
    const info = await getNodeInfo("https://example.com/");
    assertEquals(info, expected);

    const raw = await getNodeInfo("https://example.com/", { parse: "none" });
    assertEquals(raw, rawExpected);
  });

  await t.step("direct", async () => {
    const info = await getNodeInfo(
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
    const info = await getNodeInfo("https://example.com/");
    assertEquals(info, undefined);
  });

  fetchMock.removeRoutes();
  fetchMock.get("https://example.com/.well-known/nodeinfo", {
    status: 404,
  });

  await t.step("indirect: 404", async () => {
    const info = await getNodeInfo("https://example.com/");
    assertEquals(info, undefined);
  });

  await t.step("direct: 404", async () => {
    const info = await getNodeInfo(
      "https://example.com/nodeinfo/2.0",
      { direct: true },
    );
    assertEquals(info, undefined);
    const info2 = await getNodeInfo(
      "https://example.com/404",
      { direct: true },
    );
    assertEquals(info2, undefined);
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
