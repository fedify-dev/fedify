import { deepStrictEqual, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { parseIri } from "../url.ts";
import {
  getPortableGatewayCandidates,
  isPortableIri,
} from "./portable-dereference.ts";

const hrefs = (urls: URL[]) => urls.map((url) => url.href);

test("isPortableIri()", () => {
  ok(isPortableIri(parseIri("ap://did:key:z6Mkabc/actor")));
  ok(isPortableIri(parseIri("ap+ef61://did:key:z6Mkabc/actor")));
  ok(isPortableIri(new URL("ap://did%3Akey%3Az6Mkabc/actor")));
  ok(!isPortableIri(new URL("https://example.com/actor")));
  ok(!isPortableIri(new URL("did:key:z6Mkabc")));
});

test("getPortableGatewayCandidates() uses explicit gateways", () => {
  const url = parseIri(
    "ap://did:key:z6Mkabc/actor?@gateway=https%3A%2F%2Fhint.example",
  );
  deepStrictEqual(
    hrefs(getPortableGatewayCandidates(url, [
      "https://b.example",
      new URL("https://a.example/"),
      "https://b.example/",
      "http://c.example:8080",
    ])),
    ["https://b.example/", "https://a.example/", "http://c.example:8080/"],
  );
  deepStrictEqual(getPortableGatewayCandidates(url, []), []);
  for (
    const gateway of [
      "https://a.example/path",
      "https://a.example/?",
      "https://a.example/#",
      "https://user:pass@a.example",
      "ftp://a.example",
      "a.example",
    ]
  ) {
    throws(() => getPortableGatewayCandidates(url, [gateway]), TypeError);
  }
});

test("getPortableGatewayCandidates() reads @gateway hints", () => {
  deepStrictEqual(
    hrefs(getPortableGatewayCandidates(parseIri(
      "ap://did:key:z6Mkabc/actor?page=1" +
        "&@gateway=https%3A%2F%2Fa.example" +
        "&gateways=https%3A%2F%2Flegacy.example" +
        "&@gateway=not%20a%20URL" +
        "&@gateway=https%3A%2F%2Fb.example%2Fpath" +
        "&%40gateway=https%3A%2F%2Fb.example" +
        "&@gateway=https%3A%2F%2Fa.example%2F",
    ))),
    ["https://a.example/", "https://b.example/"],
  );
  deepStrictEqual(
    getPortableGatewayCandidates(parseIri("ap://did:key:z6Mkabc/actor")),
    [],
  );
  const hints = Array.from(
    { length: 7 },
    (_, i) => `@gateway=https%3A%2F%2Fg${i}.example`,
  );
  deepStrictEqual(
    hrefs(getPortableGatewayCandidates(
      parseIri(`ap://did:key:z6Mkabc/actor?${hints.join("&")}`),
    )),
    [0, 1, 2, 3, 4].map((i) => `https://g${i}.example/`),
  );
});
