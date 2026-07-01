import { deepStrictEqual, ok, rejects, throws } from "node:assert";
import { test } from "node:test";
import {
  canParseIri,
  expandIPv6Address,
  formatIri,
  haveSameIriOrigin,
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  parseIri,
  UrlError,
  validatePublicUrl,
} from "./url.ts";

test("parseIri() accepts portable ActivityPub URI schemes", () => {
  const cases = [
    "ap://did:key:z6Mkabc/actor",
    "ap://did%3Akey%3Az6Mkabc/actor",
    "ap+ef61://did:key:z6Mkabc/actor",
    "ap+ef61://did%3Akey%3Az6Mkabc/actor",
    "AP+EF61://did:key:z6Mkabc/actor",
  ];
  for (const iri of cases) {
    ok(canParseIri(iri));
    deepStrictEqual(
      parseIri(iri),
      new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
    );
  }
});

test("parseIri() accepts DID schemes case-insensitively", () => {
  const cases = [
    "ap://DID:key:z6Mkabc/actor",
    "ap://DID%3Akey%3Az6Mkabc/actor",
  ];
  for (const iri of cases) {
    ok(canParseIri(iri));
    deepStrictEqual(
      parseIri(iri),
      new URL("ap+ef61://DID%3Akey%3Az6Mkabc/actor"),
    );
  }
});

test("parseIri() accepts DID method names that start with digits", () => {
  deepStrictEqual(
    parseIri("ap://did:3:abc/actor"),
    new URL("ap+ef61://did%3A3%3Aabc/actor"),
  );
});

test("parseIri() accepts hyphens in DID method-specific IDs", () => {
  deepStrictEqual(
    parseIri("ap+ef61://did:web:foo-bar.example/actor"),
    new URL("ap+ef61://did%3Aweb%3Afoo-bar.example/actor"),
  );
});

test("parseIri() preserves existing URL parsing behavior", () => {
  deepStrictEqual(
    parseIri("/actor", new URL("https://example.com/users/alice")),
    new URL("https://example.com/actor"),
  );
  deepStrictEqual(
    parseIri("at://did:plc:example/record"),
    new URL("at://did%3Aplc%3Aexample/record"),
  );
  ok(!canParseIri("ap://not-a-did/actor"));
});

test("parseIri() resolves relative IRIs against portable string bases", () => {
  ok(canParseIri("/actor", "ap://did:key:z6Mkabc/objects/1"));
  deepStrictEqual(
    parseIri("/actor", "ap://did:key:z6Mkabc/objects/1"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
  );
  deepStrictEqual(
    parseIri("attachments/1", "ap://did:key:z6Mkabc/objects/1"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/objects/attachments/1"),
  );
});

test("parseIri() resolves relative IRIs against at:// string bases", () => {
  ok(canParseIri("/record", "at://did:plc:example/collection/item"));
  deepStrictEqual(
    parseIri("/record", "at://did:plc:example/collection/item"),
    new URL("at://did%3Aplc%3Aexample/record"),
  );
  deepStrictEqual(
    parseIri("reply", "at://did:plc:example/collection/item"),
    new URL("at://did%3Aplc%3Aexample/collection/reply"),
  );
  deepStrictEqual(
    parseIri("reply", "at://did%3Aplc%3Aexample/collection/item"),
    new URL("at://did%3Aplc%3Aexample/collection/reply"),
  );
});

test("parseIri() rejects portable IRIs without paths", () => {
  ok(!canParseIri("ap://did:key:z6Mkabc"));
  ok(
    !canParseIri("ap://did:key:z6Mkabc?gateways=https%3A%2F%2Fserver.example"),
  );
  ok(!canParseIri("ap://did:key:z6Mkabc#actor"));
});

test("parseIri() rejects malformed portable DID authorities", () => {
  const cases = [
    "ap://did:/actor",
    "ap://did:key/actor",
    "ap://did%3Akey%3Aabc%25zz/actor",
    "ap://did:key:abc%25zz/actor",
  ];
  for (const iri of cases) {
    ok(!canParseIri(iri));
    throws(() => parseIri(iri), TypeError);
  }
});

test("haveSameIriOrigin() compares portable IRI authorities", () => {
  ok(haveSameIriOrigin(
    parseIri("ap://did:key:z6Mkabc/actor"),
    parseIri("ap://did:key:z6Mkabc/outbox"),
  ));
  ok(
    !haveSameIriOrigin(
      parseIri("ap://did:key:z6Mkabc/actor"),
      parseIri("ap://did:key:z6Mkdef/actor"),
    ),
  );
});

test("parseIri() normalizes portable URL instances", () => {
  deepStrictEqual(
    parseIri(new URL("ap+ef61://did%3Aexample%3Aabc%2Fdef/actor")),
    new URL("ap+ef61://did%3Aexample%3Aabc%252Fdef/actor"),
  );
  ok(!canParseIri("ap+ef61://not-a-did/actor"));
});

test("formatIri() emits canonical portable ActivityPub URI syntax", () => {
  const cases = [
    new URL("ap://did%3Akey%3Az6Mkabc/actor"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
  ];
  for (const iri of cases) {
    deepStrictEqual(formatIri(iri), "ap+ef61://did:key:z6Mkabc/actor");
  }
  deepStrictEqual(
    formatIri(new URL("https://example.com/actor")),
    "https://example.com/actor",
  );
  deepStrictEqual(formatIri("/actor"), "/actor");
});

test("formatIri() preserves DID authority pct-encoded delimiters", () => {
  const parsed = parseIri("ap://did:example:abc%2Fdef/actor");
  deepStrictEqual(
    parsed,
    new URL("ap+ef61://did%3Aexample%3Aabc%252Fdef/actor"),
  );
  deepStrictEqual(
    formatIri(parsed),
    "ap+ef61://did:example:abc%2Fdef/actor",
  );
  deepStrictEqual(
    parseIri(formatIri(parsed)),
    parsed,
  );
  deepStrictEqual(
    formatIri(new URL("ap+ef61://did%3Aexample%3Aabc%2Fdef/actor")),
    "ap+ef61://did:example:abc%2Fdef/actor",
  );
});

test("parseIri() normalizes equivalent encoded DID authorities", () => {
  deepStrictEqual(
    parseIri("ap://did:example:abc%252Fdef/actor"),
    parseIri("ap://did%3Aexample%3Aabc%252Fdef/actor"),
  );
});

test("formatIri() preserves DID-internal pct-encoded authority characters", () => {
  const parsed = parseIri("ap://did:web:example.com%3A3000/actor");
  deepStrictEqual(
    parsed,
    new URL("ap+ef61://did%3Aweb%3Aexample.com%253A3000/actor"),
  );
  deepStrictEqual(
    formatIri(parsed),
    "ap+ef61://did:web:example.com%3A3000/actor",
  );
});

test("parseIri() accepts portable DID URLs with encoded DID delimiters", () => {
  const parsed = parseIri("ap://did:web:example.com%3A3000/u/1");
  deepStrictEqual(
    parsed,
    new URL("ap+ef61://did%3Aweb%3Aexample.com%253A3000/u/1"),
  );
  deepStrictEqual(
    formatIri(parsed),
    "ap+ef61://did:web:example.com%3A3000/u/1",
  );
});

test("validatePublicUrl()", async () => {
  await rejects(() => validatePublicUrl("ftp://localhost"), UrlError);
  await rejects(
    // cSpell: disable
    () => validatePublicUrl("data:text/plain;base64,SGVsbG8sIFdvcmxkIQ=="),
    // cSpell: enable
    UrlError,
  );
  await rejects(() => validatePublicUrl("https://localhost"), UrlError);
  await rejects(() => validatePublicUrl("https://127.0.0.1"), UrlError);
  await rejects(() => validatePublicUrl("https://[::1]"), UrlError);
  await rejects(
    () => validatePublicUrl("http://[::ffff:7f00:1]/"),
    UrlError,
  );
  await rejects(
    () => validatePublicUrl("https://[64:ff9b::7f00:1]/"),
    UrlError,
  );
  await rejects(
    () => validatePublicUrl("https://[64:ff9b::a00:1]/"),
    UrlError,
  );
  await rejects(
    () => validatePublicUrl("https://[64:ff9b:1::a00:1]/"),
    UrlError,
  );
  await rejects(
    () => validatePublicUrl("https://[64:ff9b:1::808:808]/"),
    UrlError,
  );
  await rejects(
    () => validatePublicUrl("https://[2001::]/"),
    UrlError,
  );
  await rejects(
    () => validatePublicUrl("https://[2002:a00:1::]/"),
    UrlError,
  );
  for (
    const url of [
      "https://100.64.0.1",
      "https://198.18.0.1",
      "https://224.0.0.1",
      "https://240.0.0.1",
      "https://192.0.2.1",
      "https://192.88.99.1",
      "https://198.51.100.1",
      "https://203.0.113.1",
    ]
  ) {
    await rejects(() => validatePublicUrl(url), UrlError);
  }
  await validatePublicUrl("https://[2001:db8::1]");
  await validatePublicUrl("https://[64:ff9b::8.8.8.8]");
});

test("isValidPublicIPv4Address()", () => {
  ok(isValidPublicIPv4Address("8.8.8.8")); // Google DNS
  ok(!isValidPublicIPv4Address("192.168.1.1")); // private
  ok(!isValidPublicIPv4Address("127.0.0.1")); // localhost
  ok(!isValidPublicIPv4Address("10.0.0.1")); // private
  ok(!isValidPublicIPv4Address("127.16.0.1")); // private
  ok(!isValidPublicIPv4Address("169.254.0.1")); // link-local
  ok(!isValidPublicIPv4Address("100.64.0.1")); // shared address space
  ok(!isValidPublicIPv4Address("100.127.255.255"));
  ok(!isValidPublicIPv4Address("192.0.0.1")); // IETF protocol
  ok(!isValidPublicIPv4Address("192.0.2.1")); // documentation
  ok(!isValidPublicIPv4Address("192.88.99.0")); // 6to4 relay anycast
  ok(!isValidPublicIPv4Address("192.88.99.1"));
  ok(!isValidPublicIPv4Address("192.88.99.2")); // 6a44 relay anycast
  ok(!isValidPublicIPv4Address("192.88.99.255"));
  ok(!isValidPublicIPv4Address("198.18.0.1")); // benchmarking
  ok(!isValidPublicIPv4Address("198.19.255.255"));
  ok(!isValidPublicIPv4Address("198.51.100.1")); // documentation
  ok(!isValidPublicIPv4Address("203.0.113.1")); // documentation
  ok(!isValidPublicIPv4Address("224.0.0.1")); // multicast
  ok(!isValidPublicIPv4Address("239.255.255.255"));
  ok(!isValidPublicIPv4Address("240.0.0.1")); // reserved
  ok(!isValidPublicIPv4Address("255.255.255.255")); // broadcast
  ok(!isValidPublicIPv4Address("1.2.3"));
  ok(!isValidPublicIPv4Address("999.1.1.1"));
});

test("isValidPublicIPv6Address()", () => {
  ok(isValidPublicIPv6Address("2001:db8::1"));
  ok(!isValidPublicIPv6Address("::1")); // localhost
  ok(!isValidPublicIPv6Address("fc00::1")); // ULA
  ok(!isValidPublicIPv6Address("fe80::1")); // link-local
  ok(!isValidPublicIPv6Address("ff00::1")); // multicast
  ok(!isValidPublicIPv6Address("::")); // unspecified
  ok(!isValidPublicIPv6Address("::ffff:7f00:1")); // IPv4-mapped
  ok(!isValidPublicIPv6Address("64:ff9b::7f00:1")); // NAT64 localhost
  ok(!isValidPublicIPv6Address("64:ff9b::127.0.0.1"));
  ok(!isValidPublicIPv6Address("64:ff9b::a00:1")); // NAT64 private
  ok(!isValidPublicIPv6Address("64:ff9b::10.0.0.1"));
  ok(!isValidPublicIPv6Address("64:ff9b:1::")); // local-use NAT64
  ok(!isValidPublicIPv6Address("64:ff9b:1::a00:1"));
  ok(!isValidPublicIPv6Address("64:ff9b:1::10.0.0.1"));
  ok(!isValidPublicIPv6Address("2001::")); // Teredo
  ok(!isValidPublicIPv6Address("2001:0:4136:e378:8000:63bf:3fff:fdd2"));
  ok(!isValidPublicIPv6Address("2002:a00:1::")); // 6to4
  ok(!isValidPublicIPv6Address("2002:7f00:1::"));
  ok(!isValidPublicIPv6Address("2002:c0a8:1::"));
  ok(!isValidPublicIPv6Address("2002:a9fe:1::"));
  ok(isValidPublicIPv6Address("64:ff9b::808:808")); // NAT64 public
  ok(isValidPublicIPv6Address("64:ff9b::8.8.8.8"));
});

test("expandIPv6Address()", () => {
  deepStrictEqual(
    expandIPv6Address("::"),
    "0000:0000:0000:0000:0000:0000:0000:0000",
  );
  deepStrictEqual(
    expandIPv6Address("::1"),
    "0000:0000:0000:0000:0000:0000:0000:0001",
  );
  deepStrictEqual(
    expandIPv6Address("2001:db8::"),
    "2001:0db8:0000:0000:0000:0000:0000:0000",
  );
  deepStrictEqual(
    expandIPv6Address("2001:db8::1"),
    "2001:0db8:0000:0000:0000:0000:0000:0001",
  );
  deepStrictEqual(
    expandIPv6Address("64:ff9b::8.8.8.8"),
    "0064:ff9b:0000:0000:0000:0000:0808:0808",
  );
});
