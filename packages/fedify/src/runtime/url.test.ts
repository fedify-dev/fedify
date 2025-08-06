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
});

test("isValidPublicIPv4Address()", () => {
  assert(isValidPublicIPv4Address("8.8.8.8")); // Google DNS
  assertFalse(isValidPublicIPv4Address("192.168.1.1")); // private
  assertFalse(isValidPublicIPv4Address("127.0.0.1")); // localhost
  assertFalse(isValidPublicIPv4Address("10.0.0.1")); // private
  assertFalse(isValidPublicIPv4Address("127.16.0.1")); // private
  assertFalse(isValidPublicIPv4Address("169.254.0.1")); // link-local
});

test("isValidPublicIPv6Address()", () => {
  assert(isValidPublicIPv6Address("2001:db8::1"));
  assertFalse(isValidPublicIPv6Address("::1")); // localhost
  assertFalse(isValidPublicIPv6Address("fc00::1")); // ULA
  assertFalse(isValidPublicIPv6Address("fe80::1")); // link-local
  assertFalse(isValidPublicIPv6Address("ff00::1")); // multicast
  assertFalse(isValidPublicIPv6Address("::")); // unspecified
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
});
