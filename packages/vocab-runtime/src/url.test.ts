import { deepStrictEqual, ok, rejects, throws } from "node:assert";
import { test } from "node:test";
import {
  arePortableUrisEqual,
  canonicalizePortableUri,
  expandIPv6Address,
  formatIri,
  fromCompatibleEf61Id,
  getFe34Origin,
  haveSameFe34Origin,
  haveSameIriOrigin,
  isGatewayUrl,
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  parseGatewayUrl,
  parseIri,
  parseJsonLdId,
  toCompatibleEf61Id,
  UrlError,
  validateLookupAddresses,
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
    deepStrictEqual(
      parseIri(iri),
      new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
    );
  }
});

test("parseIri() normalizes DID scheme and method casing", () => {
  const cases = [
    "ap://DID:key:z6Mkabc/actor",
    "ap://DID%3Akey%3Az6Mkabc/actor",
    "ap://did:KEY:z6Mkabc/actor",
  ];
  for (const iri of cases) {
    deepStrictEqual(
      parseIri(iri),
      new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
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
  throws(() => parseIri("ap://not-a-did/actor"), TypeError);
});

test("parseJsonLdId() parses JSON-LD ids", () => {
  deepStrictEqual(parseJsonLdId(undefined), undefined);
  deepStrictEqual(parseJsonLdId("_:blank"), undefined);
  deepStrictEqual(
    parseJsonLdId("/actor", new URL("https://example.com/users/alice")),
    new URL("https://example.com/actor"),
  );
  deepStrictEqual(
    parseJsonLdId("ap://did:key:z6Mkabc/actor"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
  );
  throws(() => parseJsonLdId("/actor"), {
    name: "TypeError",
    message: "Invalid @id: /actor",
  });
});

test("parseIri() resolves relative IRIs against portable string bases", () => {
  deepStrictEqual(
    parseIri("/actor", "ap://did:key:z6Mkabc/objects/1"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor"),
  );
  deepStrictEqual(
    parseIri("attachments/1", "ap://did:key:z6Mkabc/objects/1"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/objects/attachments/1"),
  );
  throws(
    () => parseIri("//example.com/outbox", "ap://did:key:z6Mkabc/objects/1"),
    TypeError,
  );
});

test("parseIri() resolves relative IRIs against at:// string bases", () => {
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
  throws(() => parseIri("ap://did:key:z6Mkabc"), TypeError);
  throws(
    () =>
      parseIri("ap://did:key:z6Mkabc?gateways=https%3A%2F%2Fserver.example"),
    TypeError,
  );
  throws(() => parseIri("ap://did:key:z6Mkabc#actor"), TypeError);
});

test("parseIri() rejects malformed portable DID authorities", () => {
  const cases = [
    "ap://did:/actor",
    "ap://did:key/actor",
    "ap://did%3Akey%3Aabc%25zz/actor",
    "ap://did:key:abc%25zz/actor",
  ];
  for (const iri of cases) {
    throws(() => parseIri(iri), TypeError);
  }
});

test("haveSameIriOrigin() compares portable IRI authorities", () => {
  ok(haveSameIriOrigin(
    new URL("ftp://example.com/pub/1"),
    new URL("ftp://example.com/pub/2"),
  ));
  ok(haveSameIriOrigin(
    new URL("mailto:alice@example.com"),
    new URL("mailto:alice@example.com"),
  ));
  ok(haveSameIriOrigin(
    parseIri("ap://did:key:z6Mkabc/actor"),
    parseIri("ap://did:key:z6Mkabc/outbox"),
  ));
  ok(haveSameIriOrigin(
    new URL("ap://did%3Akey%3Az6Mkabc/actor"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/outbox"),
  ));
  ok(haveSameIriOrigin(
    parseIri("ap://DID:key:z6Mkabc/actor"),
    parseIri("ap://did:key:z6Mkabc/outbox"),
  ));
  ok(haveSameIriOrigin(
    new URL("ap+ef61://DID%3Akey%3Az6Mkabc/actor"),
    new URL("ap+ef61://did%3Akey%3Az6Mkabc/outbox"),
  ));
  ok(
    !haveSameIriOrigin(
      parseIri("ap://did:key:z6Mkabc/actor"),
      parseIri("ap://did:key:z6Mkdef/actor"),
    ),
  );
});

test("getFe34Origin() computes web and cryptographic origins", () => {
  deepStrictEqual(
    getFe34Origin("https://Example.COM:443/users/alice"),
    "https://example.com",
  );
  deepStrictEqual(
    getFe34Origin(new URL("http://example.com:8080/notes/1")),
    "http://example.com:8080",
  );
  deepStrictEqual(
    getFe34Origin(
      "ap://did:key:z6Mkabc/actor?gateways=https%3A%2F%2Fa.example",
    ),
    "did:key:z6Mkabc",
  );
  deepStrictEqual(
    getFe34Origin("ap+ef61://did%3Akey%3Az6Mkabc/objects/1#fragment"),
    "did:key:z6Mkabc",
  );
  deepStrictEqual(
    getFe34Origin(new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor")),
    "did:key:z6Mkabc",
  );
  deepStrictEqual(
    getFe34Origin("did:key:z6Mkabc#z6Mkabc"),
    "did:key:z6Mkabc",
  );
  deepStrictEqual(
    getFe34Origin(new URL("did:key:z6Mkabc?service=activitypub#key")),
    "did:key:z6Mkabc",
  );
  deepStrictEqual(
    getFe34Origin("did:key:z6Mkabc/path/to/resource?service=activitypub#key"),
    "did:key:z6Mkabc",
  );
  deepStrictEqual(
    getFe34Origin("did:KEY:z6Mkabc#z6Mkabc"),
    "did:key:z6Mkabc",
  );
  deepStrictEqual(
    getFe34Origin("ap://did%3Aweb%3Afoo%2Dbar.example/actor"),
    "did:web:foo-bar.example",
  );
  deepStrictEqual(
    getFe34Origin("did:web:foo%2dbar.example#key"),
    "did:web:foo-bar.example",
  );
});

test("getFe34Origin() rejects unsupported or malformed identifiers", () => {
  for (
    const iri of [
      "mailto:alice@example.com",
      "ap://not-a-did/actor",
      "ap://did:key/actor",
      "did:key",
      "did:key:",
      "did:",
    ]
  ) {
    throws(() => getFe34Origin(iri), TypeError);
  }
});

test("haveSameFe34Origin() compares web and cryptographic origins", () => {
  ok(haveSameFe34Origin(
    "https://example.com/users/alice",
    "https://example.com/notes/1",
  ));
  ok(
    !haveSameFe34Origin(
      "https://example.com/users/alice",
      "http://example.com/users/alice",
    ),
  );
  ok(
    !haveSameFe34Origin(
      "https://example.com/users/alice",
      "https://example.com:8443/users/alice",
    ),
  );
  ok(haveSameFe34Origin(
    "ap://did:key:z6Mkabc/actor",
    "ap+ef61://did%3Akey%3Az6Mkabc/objects/1",
  ));
  ok(haveSameFe34Origin(
    "ap+ef61://did:key:z6Mkabc/actor",
    "did:key:z6Mkabc#z6Mkabc",
  ));
  ok(haveSameFe34Origin(
    "ap://did:KEY:z6Mkabc/actor",
    "did:key:z6Mkabc#z6Mkabc",
  ));
  ok(haveSameFe34Origin(
    "ap://did%3Aweb%3Afoo%2Dbar.example/actor",
    "ap://did:web:foo-bar.example/note",
  ));
  ok(haveSameFe34Origin(
    "ap://did%3Aexample%3Aabc%252fdef/actor",
    "did:example:abc%2Fdef#key",
  ));
  ok(
    !haveSameFe34Origin(
      "ap+ef61://did:key:z6Mkabc/actor",
      "did:key:z6Mkdef#z6Mkdef",
    ),
  );
  ok(
    !haveSameFe34Origin(
      "ap+ef61://did:key:z6Mkabc/actor",
      "https://example.com/actor",
    ),
  );
  ok(!haveSameFe34Origin("ap://not-a-did/actor", "ap://not-a-did/actor"));
});

test("parseIri() normalizes portable URL instances", () => {
  deepStrictEqual(
    parseIri(new URL("ap+ef61://did%3Aexample%3Aabc%2Fdef/actor")),
    new URL("ap+ef61://did%3Aexample%3Aabc%252Fdef/actor"),
  );
  throws(() => parseIri("ap+ef61://not-a-did/actor"), TypeError);
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

test("canonicalizePortableUri() emits comparison forms", () => {
  const cases = [
    "ap://did:key:z6Mkabc/actor",
    "ap://did%3Akey%3Az6Mkabc/actor",
    "ap://did:key:z6Mkabc/actor?gateways=https%3A%2F%2Fa.example",
    "ap+ef61://did:key:z6Mkabc/actor",
    "ap+ef61://did%3Akey%3Az6Mkabc/actor?gateways=https%3A%2F%2Fa.example",
  ];
  for (const iri of cases) {
    deepStrictEqual(
      canonicalizePortableUri(iri),
      "ap+ef61://did:key:z6Mkabc/actor",
    );
  }
});

test("canonicalizePortableUri() preserves paths and fragments", () => {
  deepStrictEqual(
    canonicalizePortableUri(
      "ap://did:key:z6Mkabc/objects/1/attachments/2?gateways=https%3A%2F%2Fa.example#image",
    ),
    "ap+ef61://did:key:z6Mkabc/objects/1/attachments/2#image",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did:key:z6Mkabc/objects/1#reply"),
    "ap+ef61://did:key:z6Mkabc/objects/1#reply",
  );
});

test("canonicalizePortableUri() preserves DID-internal pct-encoded characters", () => {
  deepStrictEqual(
    canonicalizePortableUri("ap://did:example:abc%2Fdef/actor?x=1"),
    "ap+ef61://did:example:abc%2Fdef/actor",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did%3Aweb%3Aexample.com%253A3000/u/1"),
    "ap+ef61://did:web:example.com%3A3000/u/1",
  );
});

test("canonicalizePortableUri() normalizes authority pct-encoding casing", () => {
  deepStrictEqual(
    canonicalizePortableUri("ap://did:example:abc%2fdef/actor"),
    "ap+ef61://did:example:abc%2Fdef/actor",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did:example:abc%2fdef%3abar/actor"),
    "ap+ef61://did:example:abc%2Fdef%3Abar/actor",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did%3Aexample%3Aabc%252fdef/actor"),
    "ap+ef61://did:example:abc%2Fdef/actor",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did%3Akey%3Az6Mk%2Dabc/actor"),
    "ap+ef61://did:key:z6Mk-abc/actor",
  );
  ok(arePortableUrisEqual(
    "ap://did:example:abc%2fdef/actor",
    "ap://did:example:abc%2Fdef/actor",
  ));
  ok(arePortableUrisEqual(
    "ap://did%3Akey%3Az6Mk%2Dabc/actor",
    "ap://did:key:z6Mk-abc/actor",
  ));
});

test("canonicalizePortableUri() normalizes path and fragment pct-encoding casing", () => {
  deepStrictEqual(
    canonicalizePortableUri("ap://did:key:z6Mkabc/actor%2fprofile#part%2ftwo"),
    "ap+ef61://did:key:z6Mkabc/actor%2Fprofile#part%2Ftwo",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did:key:z6Mkabc/actor%2fprofile%3aimage"),
    "ap+ef61://did:key:z6Mkabc/actor%2Fprofile%3Aimage",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did:key:z6Mkabc/actor%2Dprofile#part%7Etwo"),
    "ap+ef61://did:key:z6Mkabc/actor-profile#part~two",
  );
  ok(arePortableUrisEqual(
    "ap://did:key:z6Mkabc/actor%2fprofile#part%2ftwo",
    "ap://did:key:z6Mkabc/actor%2Fprofile#part%2Ftwo",
  ));
  ok(arePortableUrisEqual(
    "ap://did:key:z6Mkabc/actor%2Dprofile#part%7Etwo",
    "ap://did:key:z6Mkabc/actor-profile#part~two",
  ));
});

test("canonicalizePortableUri() encodes raw path and fragment characters", () => {
  deepStrictEqual(
    canonicalizePortableUri("ap://did:key:z6Mkabc/\u00e9#\u00e9"),
    "ap+ef61://did:key:z6Mkabc/%C3%A9#%C3%A9",
  );
  ok(arePortableUrisEqual(
    "ap://did:key:z6Mkabc/\u00e9#\u00e9",
    "ap://did:key:z6Mkabc/%C3%A9#%C3%A9",
  ));
});

test("canonicalizePortableUri() normalizes DID scheme casing", () => {
  deepStrictEqual(
    canonicalizePortableUri("ap://DID:key:z6Mkabc/actor"),
    "ap+ef61://did:key:z6Mkabc/actor",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://DID%3Akey%3Az6Mkabc/actor"),
    "ap+ef61://did:key:z6Mkabc/actor",
  );
});

test("canonicalizePortableUri() preserves opaque path segments", () => {
  deepStrictEqual(
    canonicalizePortableUri("ap://did:key:z6Mkabc/a/../b?gateways=x"),
    "ap+ef61://did:key:z6Mkabc/a/../b",
  );
  deepStrictEqual(
    canonicalizePortableUri("ap://did:key:z6Mkabc/a/%2e%2e/b"),
    "ap+ef61://did:key:z6Mkabc/a/../b",
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/a/../b",
      "ap://did:key:z6Mkabc/b",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/a/%2e%2e/b",
      "ap://did:key:z6Mkabc/b",
    ),
  );
});

test("canonicalizePortableUri() rejects non-portable URIs", () => {
  const cases = [
    "https://example.com/actor",
    "at://did:plc:example/record",
    "/actor",
    "ap://not-a-did/actor",
    "ap://did:key:z6Mkabc",
  ];
  for (const iri of cases) {
    throws(() => canonicalizePortableUri(iri), TypeError);
  }
  throws(
    () =>
      canonicalizePortableUri(
        new URL("ap+ef61://did%3Akey%3Az6Mkabc/actor") as unknown as string,
      ),
    TypeError,
  );
});

test("canonicalizePortableUri() rejects invalid path and fragment pct-encoding", () => {
  throws(() => canonicalizePortableUri("ap://did:key:z6Mkabc/a%zz"), TypeError);
  throws(
    () => canonicalizePortableUri("ap://did:key:z6Mkabc/actor#part%zz"),
    TypeError,
  );
  throws(
    () => canonicalizePortableUri("ap://did:key:z6Mkabc/\ud800"),
    TypeError,
  );
  throws(
    () => canonicalizePortableUri("ap://did:key:z6Mkabc/actor#\ud800"),
    TypeError,
  );
});

test("arePortableUrisEqual() compares canonical portable URI forms", () => {
  ok(arePortableUrisEqual(
    "ap://did:key:z6Mkabc/actor",
    "ap+ef61://did%3Akey%3Az6Mkabc/actor?gateways=https%3A%2F%2Fa.example",
  ));
  ok(arePortableUrisEqual(
    "ap://DID:key:z6Mkabc/actor",
    "ap://did:key:z6Mkabc/actor",
  ));
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/actor",
      "ap://did:key:z6Mkdef/actor",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/actor",
      "ap://did:key:z6Mkabc/outbox",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/actor#one",
      "ap://did:key:z6Mkabc/actor#two",
    ),
  );
});

test("arePortableUrisEqual() handles non-portable URI strings", () => {
  ok(arePortableUrisEqual(
    "https://example.com/actor",
    "https://example.com/actor",
  ));
  ok(
    !arePortableUrisEqual(
      "https://example.com/actor",
      "https://example.com/outbox",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/actor",
      "https://example.com/actor",
    ),
  );
  ok(arePortableUrisEqual("ap://not-a-did/actor", "ap://not-a-did/actor"));
  ok(
    !arePortableUrisEqual(
      "ap://not-a-did/actor",
      "ap://not-a-did/outbox",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://not-a-did/actor",
      "ap://did:key:z6Mkabc/actor",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/a%zz",
      "ap://did:key:z6Mkabc/a%25zz",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/\ud800",
      "ap://did:key:z6Mkabc/%EF%BF%BD",
    ),
  );
  ok(
    !arePortableUrisEqual(
      "ap://did:key:z6Mkabc/actor#\ud800",
      "ap://did:key:z6Mkabc/actor#%EF%BF%BD",
    ),
  );
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

test("parseIri() decodes pct-encoded DID delimiters in order", () => {
  const parsed = parseIri("ap://did%3Aweb%3Aexample.com%253A3000/u/1");
  deepStrictEqual(
    parsed,
    new URL("ap+ef61://did%3Aweb%3Aexample.com%253A3000/u/1"),
  );
  deepStrictEqual(
    formatIri(parsed),
    "ap+ef61://did:web:example.com%3A3000/u/1",
  );
});

test("parseIri() preserves encoded percent signs while decoding delimiters", () => {
  const parsed = parseIri("ap://did%3Aweb%3Aexample.com%2500/u/1");
  deepStrictEqual(
    parsed,
    new URL("ap+ef61://did%3Aweb%3Aexample.com%2500/u/1"),
  );
  deepStrictEqual(
    formatIri(parsed),
    "ap+ef61://did:web:example.com%00/u/1",
  );
});

test("parseGatewayUrl() accepts only HTTP(S) base URIs", () => {
  for (const url of ["https://server.example/", "http://server.example/"]) {
    deepStrictEqual(parseGatewayUrl(url), new URL(url));
    ok(isGatewayUrl(new URL(url)));
  }

  for (
    const url of [
      "ftp://server.example/",
      "https://user:pass@server.example/",
      "https://user@server.example/",
      "https://server.example/path",
      "https://server.example/?x=1",
      "https://server.example/#fragment",
    ]
  ) {
    throws(() => parseGatewayUrl(url), TypeError);
    ok(!isGatewayUrl(new URL(url)));
  }
});

test("fromCompatibleEf61Id() converts compatible identifiers", () => {
  const cases: [string, string][] = [
    [
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/objects/1",
      "ap+ef61://did%3Akey%3Az6MkAlice/objects/1",
    ],
    [
      "http://server.example:8080/.well-known/apgateway/did:key:z6MkAlice/actor",
      "ap+ef61://did%3Akey%3Az6MkAlice/actor",
    ],
    [
      "https://server.example/.well-known/apgateway/did%3Akey%3Az6MkAlice/actor",
      "ap+ef61://did%3Akey%3Az6MkAlice/actor",
    ],
    [
      "https://server.example/.well-known/apgateway/DID:key:z6MkAlice/actor",
      "ap+ef61://did%3Akey%3Az6MkAlice/actor",
    ],
    [
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a/b/c",
      "ap+ef61://did%3Akey%3Az6MkAlice/a/b/c",
    ],
    [
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor#main-key",
      "ap+ef61://did%3Akey%3Az6MkAlice/actor#main-key",
    ],
    [
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor#",
      "ap+ef61://did%3Akey%3Az6MkAlice/actor#",
    ],
    [
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/outbox?page=2",
      "ap+ef61://did%3Akey%3Az6MkAlice/outbox?page=2",
    ],
    [
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a%2Fb",
      "ap+ef61://did%3Akey%3Az6MkAlice/a%2Fb",
    ],
    [
      "https://server.example/.well-known/apgateway/did:web:example.com%3A8080/actor",
      "ap+ef61://did%3Aweb%3Aexample.com%253A8080/actor",
    ],
    [
      "https://server.example/.well-known/apgateway/did:example:a%2525/x",
      "ap+ef61://did%3Aexample%3Aa%2525/x",
    ],
  ];
  for (const [input, expected] of cases) {
    deepStrictEqual(fromCompatibleEf61Id(input)?.href, expected, input);
    deepStrictEqual(
      fromCompatibleEf61Id(new URL(input))?.href,
      expected,
      input,
    );
  }
  const converted = fromCompatibleEf61Id(
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/objects/1",
  );
  deepStrictEqual(
    formatIri(converted!),
    "ap+ef61://did:key:z6MkAlice/objects/1",
  );
  deepStrictEqual(
    canonicalizePortableUri(converted!.href),
    "ap+ef61://did:key:z6MkAlice/objects/1",
  );
  ok(
    arePortableUrisEqual(
      fromCompatibleEf61Id(
        "https://a.example/.well-known/apgateway/did:key:z6MkAlice/actor",
      )!.href,
      fromCompatibleEf61Id(
        "https://b.example/.well-known/apgateway/did:key:z6MkAlice/actor",
      )!.href,
    ),
  );
});

test("fromCompatibleEf61Id() returns null for other URLs", () => {
  const cases = [
    "https://server.example/users/alice",
    "https://server.example/.well-known/webfinger?resource=acct:a@b",
    "https://server.example/.well-known/apgateway",
    "https://server.example/.well-known/apgateway/",
    "https://server.example/.well-known/apgateway/hl:zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n",
    "https://server.example/.well-known/apgateway/objects/did:key:z6MkAlice/x",
    "https://server.example/.well-known/apgatewayx/did:key:z6MkAlice/x",
    "https://server.example/ap/did:key:z6MkAlice/actor",
    "https://server.example/?id=/.well-known/apgateway/did:key:z6MkAlice/x",
    "ap://did:key:z6MkAlice/actor",
    "ap+ef61://did:key:z6MkAlice/actor",
    "ftp://server.example/.well-known/apgateway/did:key:z6MkAlice/actor",
    "not a URL",
    "/.well-known/apgateway/did:key:z6MkAlice/actor",
  ];
  for (const input of cases) {
    deepStrictEqual(fromCompatibleEf61Id(input), null, input);
  }
  deepStrictEqual(
    fromCompatibleEf61Id(new URL("ap+ef61://did%3Akey%3Az6MkAlice/actor")),
    null,
  );
  deepStrictEqual(fromCompatibleEf61Id(123 as unknown as string), null);
});

test("fromCompatibleEf61Id() rejects malformed compatible identifiers", () => {
  const cases = [
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice",
    "https://server.example/.well-known/apgateway/did:",
    "https://server.example/.well-known/apgateway/did:key/actor",
    "https://server.example/.well-known/apgateway/did:ke%y:z6MkAlice/actor",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a%zz",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a#%zz",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a?x=%zz",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a?@gateway=https%3A%2F%2Fevil.example",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a?page=2&%40gateway=x",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a?@%67ateway=x",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a?gateways=x",
    // A readable DID authority is percent-decoded once, like parseIri() does,
    // which leaves a bare percent sign here:
    "https://server.example/.well-known/apgateway/did:example:a%25/x",
    "https://user:pass@server.example/.well-known/apgateway/did:key:z6MkAlice/a",
    "https://user@server.example/.well-known/apgateway/did:key:z6MkAlice/a",
  ];
  for (const input of cases) {
    throws(() => fromCompatibleEf61Id(input), TypeError, input);
  }
});

test("toCompatibleEf61Id() converts portable URIs", () => {
  const cases: [string | URL, string | URL, string][] = [
    [
      "ap+ef61://did:key:z6MkAlice/objects/1",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/objects/1",
    ],
    [
      "ap://did:key:z6MkAlice/objects/1",
      "https://server.example/",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/objects/1",
    ],
    [
      "ap://did%3Akey%3Az6MkAlice/actor",
      new URL("http://server.example:8080"),
      "http://server.example:8080/.well-known/apgateway/did:key:z6MkAlice/actor",
    ],
    [
      new URL("ap+ef61://did%3Akey%3Az6MkAlice/actor"),
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor",
    ],
    [
      new URL("ap://did%3Akey%3Az6MkAlice/actor"),
      "https://SERVER.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor",
    ],
    [
      "ap://did:key:z6MkAlice/a/b/c",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a/b/c",
    ],
    [
      "ap://did:key:z6MkAlice/actor#main-key",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor#main-key",
    ],
    [
      "ap://did:key:z6MkAlice/actor#",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor#",
    ],
    [
      "ap://DID:key:z6MkAlice/actor",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor",
    ],
    [
      "ap://did:example:a%2525/x",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:example:a%2525/x",
    ],
    [
      "ap://did:web:example.com%3A8080/actor",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:web:example.com%3A8080/actor",
    ],
    [
      "ap://did:key:z6MkAlice/a%2Fb/%252e",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a%2Fb/%252e",
    ],
    [
      "ap://did:key:z6MkAlice/a\\b c\té/%7euser",
      "https://server.example",
      "https://server.example/.well-known/apgateway/did:key:z6MkAlice/a%5Cb%20c%09%C3%A9/~user",
    ],
  ];
  for (const [portableId, gateway, expected] of cases) {
    deepStrictEqual(
      toCompatibleEf61Id(portableId, gateway).href,
      expected,
      String(portableId),
    );
  }
});

test("toCompatibleEf61Id() removes location hints from queries", () => {
  const base = "https://server.example/.well-known/apgateway/did:key:z6MkAlice";
  const cases: [string, string][] = [
    [
      "ap://did:key:z6MkAlice/actor?@gateway=https%3A%2F%2Fa.example&@gateway=https%3A%2F%2Fb.example",
      `${base}/actor`,
    ],
    [
      "ap://did:key:z6MkAlice/actor?gateways=https%3A%2F%2Fa.example",
      `${base}/actor`,
    ],
    [
      "ap://did:key:z6MkAlice/actor?%40gateway=https%3A%2F%2Fa.example",
      `${base}/actor`,
    ],
    [
      "ap://did:key:z6MkAlice/actor?@%67ateway=https%3A%2F%2Fa.example",
      `${base}/actor`,
    ],
    [
      "ap://did:key:z6MkAlice/actor?@gateway",
      `${base}/actor`,
    ],
    [
      "ap://did:key:z6MkAlice/c?page=3&@gateway=https%3A%2F%2Fa.example&maxItems=20&page=4",
      `${base}/c?page=3&maxItems=20&page=4`,
    ],
    [
      "ap://did:key:z6MkAlice/c?a=1&&b=2#frag",
      `${base}/c?a=1&&b=2#frag`,
    ],
    ["ap://did:key:z6MkAlice/c?", `${base}/c?`],
    ["ap://did:key:z6MkAlice/c?x='y'", `${base}/c?x=%27y%27`],
    [
      "ap://did:key:z6MkAlice/c?@gate\tway=https%3A%2F%2Fa.example",
      `${base}/c?@gate%09way=https%3A%2F%2Fa.example`,
    ],
    [
      "ap://did:key:z6MkAlice/c?@gate\nway=1&x=\r2",
      `${base}/c?@gate%0Away=1&x=%0D2`,
    ],
    ["ap://did:key:z6MkAlice/c?%ff=1", `${base}/c?%FF=1`],
  ];
  for (const [portableId, expected] of cases) {
    const result = toCompatibleEf61Id(portableId, "https://server.example");
    deepStrictEqual(result.href, expected, portableId);
    ok(!/[?&](%40|@)gateway(=|&|$)/i.test(result.search), portableId);
  }
});

test("toCompatibleEf61Id() rejects invalid portable IDs", () => {
  const cases: (string | URL)[] = [
    "https://server.example/actor",
    "https://server.example/.well-known/apgateway/did:key:z6MkAlice/actor",
    "at://did:plc:example/record",
    "ap://not-a-did/actor",
    "ap://did:key:z6MkAlice",
    "ap://did:key:z6MkAlice/a%zz",
    "ap://did:key:z6MkAlice/a#%zz",
    "ap://did:key:z6MkAlice/a?x=%zz",
    "ap://did:key:z6MkAlice/.",
    "ap://did:key:z6MkAlice/..",
    "ap://did:key:z6MkAlice/a/./b",
    "ap://did:key:z6MkAlice/a/../b",
    "ap://did:key:z6MkAlice/a/%2e/b",
    "ap://did:key:z6MkAlice/a/%2E%2e/b",
    "ap://did:key:z6MkAlice/a/.%2e/b",
    "ap://did:key:z6MkAlice/a/%2e./b",
    new URL("https://server.example/actor"),
    new URL("ap+ef61://user:pass@did%3Akey%3Az6MkAlice/actor"),
    new URL("ap+ef61://did%3Akey%3Az6MkAlice:8080/actor"),
    123 as unknown as string,
  ];
  for (const portableId of cases) {
    throws(
      () => toCompatibleEf61Id(portableId, "https://server.example"),
      TypeError,
      String(portableId),
    );
  }
});

test("toCompatibleEf61Id() rejects gateways that are not HTTP(S) origins", () => {
  const cases: (string | URL)[] = [
    "ftp://server.example",
    "ap+ef61://did:key:z6MkAlice/actor",
    "https://user:pass@server.example",
    "https://user@server.example",
    "https://server.example/ap",
    "https://server.example/ap/",
    "https://server.example/.well-known/apgateway",
    "https://server.example/?x=1",
    "https://server.example/?",
    "https://server.example/#fragment",
    "https://server.example/#",
    "server.example",
    "",
    new URL("https://server.example/?"),
    new URL("https://server.example/#"),
    new URL("https://server.example/ap"),
    new URL("ftp://server.example/"),
    123 as unknown as string,
  ];
  for (const gateway of cases) {
    throws(
      () => toCompatibleEf61Id("ap://did:key:z6MkAlice/actor", gateway),
      TypeError,
      String(gateway),
    );
  }
});

test("compatible identifier conversion round-trips", () => {
  const cases = [
    "ap+ef61://did:key:z6MkAlice/objects/1",
    "ap://did:key:z6MkAlice/actor",
    "ap://did%3Akey%3Az6MkAlice/actor/inbox",
    "ap://did:key:z6MkAlice/actor#",
    "ap://did:key:z6MkAlice/actor#main-key",
    "ap://did:key:z6MkAlice/a%2Fb/%252e",
    "ap://did:key:z6MkAlice/a\\b c\té",
    "ap://did:example:a%2525/x",
    "ap://did:web:example.com%3A8080/actor",
    "ap://did:key:z6MkAlice/c?page=3&@gateway=https%3A%2F%2Fa.example",
  ];
  for (const portableId of cases) {
    const compatible = toCompatibleEf61Id(portableId, "https://server.example");
    const converted = fromCompatibleEf61Id(compatible);
    ok(converted != null, portableId);
    deepStrictEqual(
      canonicalizePortableUri(converted.href),
      canonicalizePortableUri(portableId),
      portableId,
    );
  }
  ok(
    !arePortableUrisEqual(
      fromCompatibleEf61Id(
        toCompatibleEf61Id(
          "ap://did:key:z6MkAlice/actor",
          "https://server.example",
        ),
      )!.href,
      fromCompatibleEf61Id(
        toCompatibleEf61Id(
          "ap://did:key:z6MkAlice/actor#",
          "https://server.example",
        ),
      )!.href,
    ),
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

test("validateLookupAddresses() tolerates Cloudflare Workers CNAME entries", () => {
  validateLookupAddresses([
    { address: "app-host.example.net.", family: 4 },
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);
});

test("validateLookupAddresses() rejects unsafe or CNAME-only Cloudflare Workers results", () => {
  throws(
    () =>
      validateLookupAddresses([
        { address: "private-host.example.net.", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    UrlError,
  );
  throws(
    () =>
      validateLookupAddresses([
        { address: "app-host.example.net.", family: 4 },
      ]),
    UrlError,
  );
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
