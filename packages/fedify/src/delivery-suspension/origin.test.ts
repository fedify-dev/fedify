import { equal } from "node:assert/strict";
import { test } from "@fedify/fixture";
import {
  getDeliverySuspensionUrlOrigin,
  parseDeliverySuspensionOrigin,
  validateHttpsUri,
} from "./origin.ts";

test("delivery suspension origins preserve DNS spelling and normalize ports", () => {
  const cases = [
    [
      "HTTPS://SOCIAL.example:443/",
      "https://social.example",
      "social.example",
      443,
    ],
    [
      "https://social.example:",
      "https://social.example",
      "social.example",
      443,
    ],
    [
      "https://social.example:000443",
      "https://social.example",
      "social.example",
      443,
    ],
    [
      "https://social.example:000",
      "https://social.example:0",
      "social.example",
      0,
    ],
    [
      "https://social.example:08443/",
      "https://social.example:8443",
      "social.example",
      8443,
    ],
    [
      "https://social.example.:65535",
      "https://social.example.:65535",
      "social.example.",
      65535,
    ],
    ["https://test.42", "https://test.42", "test.42", 443],
    ["https://test.42.", "https://test.42.", "test.42.", 443],
    [
      "https://XN--FA-HIA.example",
      "https://xn--fa-hia.example",
      "xn--fa-hia.example",
      443,
    ],
    ["https://fass.example", "https://fass.example", "fass.example", 443],
    [
      "https://xn----b-2b1t.example",
      "https://xn----b-2b1t.example",
      "xn----b-2b1t.example",
      443,
    ],
  ] as const;
  for (const [raw, normalized, hostname, port] of cases) {
    const result = parseDeliverySuspensionOrigin(raw);
    equal(result.ok, true, raw);
    if (!result.ok) continue;
    equal(result.value.raw, raw);
    equal(result.value.normalized, normalized);
    equal(result.value.hostname, hostname);
    equal(result.value.port, port);
    equal(result.warnings.length, 0);
    equal(Object.isFrozen(result.value), true);
  }
});

test("delivery suspension origins validate IP literals before URL normalization", () => {
  for (const [raw, normalized, hostname] of [
    ["https://192.0.2.1", "https://192.0.2.1", "192.0.2.1"],
    ["https://0.0.0.0", "https://0.0.0.0", "0.0.0.0"],
    [
      "https://[2001:0DB8:0:0:0:0:0:1]:443/",
      "https://[2001:db8::1]",
      "2001:db8::1",
    ],
    [
      "https://[::ffff:192.0.2.1]:8443",
      "https://[::ffff:c000:201]:8443",
      "::ffff:c000:201",
    ],
    ["https://[0:0:0:0:0:0:0:0]", "https://[::]", "::"],
    ["https://[1:0:0:2:0:0:3:4]", "https://[1::2:0:0:3:4]", "1::2:0:0:3:4"],
  ]) {
    const result = parseDeliverySuspensionOrigin(raw);
    equal(result.ok, true, raw);
    if (result.ok) {
      equal(result.value.normalized, normalized);
      equal(result.value.hostname, hostname);
    }
  }
  for (const host of [
    "127.1",
    "2130706433",
    "0x7f000001",
    "0177.0.0.1",
    "127.00.0.1",
    "127.0.0.1.",
    "256.0.0.1",
    "0x7f.0.0.1",
    "0x",
    "1.2.3",
    "1.2.3.4.5",
    "[::ffff:192.00.2.1]",
    "[::ffff:256.0.0.1]",
    "[1:2:3:4:5:6:7]",
    "[1:2:3:4:5:6:7:8:9]",
    "[1::2::3]",
    "[:::]",
    "[::1%25eth0]",
    "[::1%eth0]",
    "[v1.future]",
  ]) {
    equal(parseDeliverySuspensionOrigin(`https://${host}`).ok, false, host);
  }
});

test("delivery suspension origins reject lossy and non-origin wire spellings", () => {
  for (const raw of [
    "http://example.org",
    "https:example.org",
    "https:///example.org",
    "https://",
    "https://user@example.org",
    "https://user:pass@example.org",
    "https://@example.org",
    " https://example.org",
    "https://example.org ",
    "https://example.org\n",
    "https://exam\tple.org",
    "https://example.org\\",
    "https://example.org\\@evil.org",
    "https://%65xample.org",
    "https://faß.example",
    "https://ｅxample.org",
    "https://xn--abc-.example",
    "https://xn--a--b-9k5y.example",
    "https://example..org",
    "https://-example.org",
    "https://ab--cd.org",
    "https://exa_mple.org",
    "https://example.org:65536",
    "https://example.org:-1",
    "https://example.org:+443",
    "https://example.org:1e2",
    "https://example.org:443x",
    "https://example.org:1:2",
    "https://example.org?",
    "https://example.org#",
    "https://example.org/?",
    "https://example.org/#",
    "https://example.org//",
    "https://example.org/.",
    "https://example.org/%2e",
    "https://example.org/a",
    "https://example.org/%ZZ",
  ])
    equal(parseDeliverySuspensionOrigin(raw).ok, false, raw);
  // An already-created URL has lost this evidence. Callers must supply raw strings.
  const lossy = "https://127.1";
  equal(parseDeliverySuspensionOrigin(lossy).ok, false);
  equal(parseDeliverySuspensionOrigin(new URL(lossy).href).ok, true);
});

test("delivery suspension endpoint origins share strict authorities and allow URI suffixes", () => {
  for (const suffix of [
    "/inbox",
    "/a/../b",
    "/%2e",
    "//a",
    "/inbox?x=%20#section",
    "?",
    "#",
    "/a:@!$&'()*+,;=-._~%2f?x=/??#a/?",
  ]) {
    const raw = `HTTPS://Test.42:00443${suffix}`;
    const result = getDeliverySuspensionUrlOrigin(raw);
    equal(result.ok, true, raw);
    if (result.ok) {
      equal(result.value.normalized, "https://test.42");
      equal(result.value.raw, raw);
    }
  }
  for (const raw of [
    "https://127.1/inbox",
    "https://example.org/a%",
    "https://example.org/%xy",
    "https://example.org/a#b#c",
    "https://example.org/a[b]",
    "https://example.org/a b",
    "https://example.org/é",
    "https://example.org:65536/inbox",
  ])
    equal(getDeliverySuspensionUrlOrigin(raw).ok, false, raw);
});

test("delivery suspension HTTPS syntax retains claims beyond strict IDNA origins", () => {
  for (const raw of [
    "https://a_b.example/inbox",
    "https://xn--abc-.example/inbox",
    "https://127.1/inbox",
    "https://example.org:65536/inbox",
    "https://[v1.future]/inbox",
    "https://%65xample.org/inbox",
    "https://%E4%BE%8B.example/inbox",
  ]) {
    equal(validateHttpsUri(raw), null, raw);
    equal(getDeliverySuspensionUrlOrigin(raw).ok, false, raw);
    equal(
      parseDeliverySuspensionOrigin(raw.replace(/\/inbox$/, "")).ok,
      false,
      raw,
    );
  }
  for (const raw of [
    "https://user@example.org/inbox",
    "https://%6xample.org/inbox",
    "https://example%.org/inbox",
    "https://[::1%25eth0]/inbox",
    "https://example.org/%g0",
    "https://example.org:abc/inbox",
    "https://example.org/a\u0000",
    "https://example.org/\\a",
    "https://[::ffff:01.2.3.4]/inbox",
  ])
    equal(typeof validateHttpsUri(raw), "string", raw);
});
