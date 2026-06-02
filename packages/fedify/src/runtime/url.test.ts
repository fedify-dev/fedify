import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/assert-equals";
import { assertFalse } from "@std/assert/assert-false";
import { assertRejects } from "@std/assert/assert-rejects";
import { test } from "../testing/mod.ts";
import {
  expandIPv6Address,
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  UrlError,
  validatePublicUrl,
} from "./url.ts";

test("validatePublicUrl()", async () => {
  await assertRejects(() => validatePublicUrl("ftp://localhost"), UrlError);
  await assertRejects(
    // cSpell: disable
    () => validatePublicUrl("data:text/plain;base64,SGVsbG8sIFdvcmxkIQ=="),
    // cSpell: enable
    UrlError,
  );
  await assertRejects(() => validatePublicUrl("https://localhost"), UrlError);
  await assertRejects(() => validatePublicUrl("https://127.0.0.1"), UrlError);
  await assertRejects(() => validatePublicUrl("https://[::1]"), UrlError);
  await assertRejects(
    () => validatePublicUrl("http://[::ffff:7f00:1]/"),
    UrlError,
  );
  await assertRejects(
    () => validatePublicUrl("https://[64:ff9b::7f00:1]/"),
    UrlError,
  );
  await assertRejects(
    () => validatePublicUrl("https://[64:ff9b::a00:1]/"),
    UrlError,
  );
  await assertRejects(
    () => validatePublicUrl("https://[64:ff9b:1::a00:1]/"),
    UrlError,
  );
  await assertRejects(
    () => validatePublicUrl("https://[64:ff9b:1::808:808]/"),
    UrlError,
  );
  await assertRejects(
    () => validatePublicUrl("https://[2001::]/"),
    UrlError,
  );
  await assertRejects(
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
    await assertRejects(() => validatePublicUrl(url), UrlError);
  }
  await validatePublicUrl("https://[2001:db8::1]");
  await validatePublicUrl("https://[64:ff9b::8.8.8.8]");
});

test("isValidPublicIPv4Address()", () => {
  assert(isValidPublicIPv4Address("8.8.8.8")); // Google DNS
  assertFalse(isValidPublicIPv4Address("192.168.1.1")); // private
  assertFalse(isValidPublicIPv4Address("127.0.0.1")); // localhost
  assertFalse(isValidPublicIPv4Address("10.0.0.1")); // private
  assertFalse(isValidPublicIPv4Address("127.16.0.1")); // private
  assertFalse(isValidPublicIPv4Address("169.254.0.1")); // link-local
  assertFalse(isValidPublicIPv4Address("100.64.0.1")); // shared address space
  assertFalse(isValidPublicIPv4Address("100.127.255.255"));
  assertFalse(isValidPublicIPv4Address("192.0.0.1")); // IETF protocol
  assertFalse(isValidPublicIPv4Address("192.0.2.1")); // documentation
  assertFalse(isValidPublicIPv4Address("192.88.99.0")); // 6to4 relay anycast
  assertFalse(isValidPublicIPv4Address("192.88.99.1"));
  assertFalse(isValidPublicIPv4Address("192.88.99.2")); // 6a44 relay anycast
  assertFalse(isValidPublicIPv4Address("192.88.99.255"));
  assertFalse(isValidPublicIPv4Address("198.18.0.1")); // benchmarking
  assertFalse(isValidPublicIPv4Address("198.19.255.255"));
  assertFalse(isValidPublicIPv4Address("198.51.100.1")); // documentation
  assertFalse(isValidPublicIPv4Address("203.0.113.1")); // documentation
  assertFalse(isValidPublicIPv4Address("224.0.0.1")); // multicast
  assertFalse(isValidPublicIPv4Address("239.255.255.255"));
  assertFalse(isValidPublicIPv4Address("240.0.0.1")); // reserved
  assertFalse(isValidPublicIPv4Address("255.255.255.255")); // broadcast
  assertFalse(isValidPublicIPv4Address("1.2.3"));
  assertFalse(isValidPublicIPv4Address("999.1.1.1"));
});

test("isValidPublicIPv6Address()", () => {
  assert(isValidPublicIPv6Address("2001:db8::1"));
  assertFalse(isValidPublicIPv6Address("::1")); // localhost
  assertFalse(isValidPublicIPv6Address("fc00::1")); // ULA
  assertFalse(isValidPublicIPv6Address("fe80::1")); // link-local
  assertFalse(isValidPublicIPv6Address("ff00::1")); // multicast
  assertFalse(isValidPublicIPv6Address("::")); // unspecified
  assertFalse(isValidPublicIPv6Address("::ffff:7f00:1")); // IPv4-mapped
  assertFalse(isValidPublicIPv6Address("64:ff9b::7f00:1")); // NAT64 localhost
  assertFalse(isValidPublicIPv6Address("64:ff9b::127.0.0.1"));
  assertFalse(isValidPublicIPv6Address("64:ff9b::a00:1")); // NAT64 private
  assertFalse(isValidPublicIPv6Address("64:ff9b::10.0.0.1"));
  assertFalse(isValidPublicIPv6Address("64:ff9b:1::")); // local-use NAT64
  assertFalse(isValidPublicIPv6Address("64:ff9b:1::a00:1"));
  assertFalse(isValidPublicIPv6Address("64:ff9b:1::10.0.0.1"));
  assertFalse(isValidPublicIPv6Address("2001::")); // Teredo
  assertFalse(isValidPublicIPv6Address("2001:0:4136:e378:8000:63bf:3fff:fdd2"));
  assertFalse(isValidPublicIPv6Address("2002:a00:1::")); // 6to4
  assertFalse(isValidPublicIPv6Address("2002:7f00:1::"));
  assertFalse(isValidPublicIPv6Address("2002:c0a8:1::"));
  assertFalse(isValidPublicIPv6Address("2002:a9fe:1::"));
  assert(isValidPublicIPv6Address("64:ff9b::808:808")); // NAT64 public
  assert(isValidPublicIPv6Address("64:ff9b::8.8.8.8"));
});

test("expandIPv6Address()", () => {
  assertEquals(
    expandIPv6Address("::"),
    "0000:0000:0000:0000:0000:0000:0000:0000",
  );
  assertEquals(
    expandIPv6Address("::1"),
    "0000:0000:0000:0000:0000:0000:0000:0001",
  );
  assertEquals(
    expandIPv6Address("2001:db8::"),
    "2001:0db8:0000:0000:0000:0000:0000:0000",
  );
  assertEquals(
    expandIPv6Address("2001:db8::1"),
    "2001:0db8:0000:0000:0000:0000:0000:0001",
  );
  assertEquals(
    expandIPv6Address("64:ff9b::8.8.8.8"),
    "0064:ff9b:0000:0000:0000:0000:0808:0808",
  );
});
