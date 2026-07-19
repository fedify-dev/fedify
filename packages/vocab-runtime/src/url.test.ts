import { deepStrictEqual, ok, rejects, throws } from "node:assert";
import { test } from "node:test";
import {
  expandIPv6Address,
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  UrlError,
  validateLookupAddresses,
  validatePublicUrl,
} from "./url.ts";

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

test("validateLookupAddresses() ignores CNAME results", () => {
  validateLookupAddresses([
    { address: "app-host.example.net.", family: 4 },
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]);
});

test("validateLookupAddresses() rejects unsafe or alias-only results", () => {
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
