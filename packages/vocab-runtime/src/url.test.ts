import { deepStrictEqual, ok, rejects } from "node:assert";
import { test } from "node:test";
import {
  expandIPv6Address,
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  UrlError,
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
  await validatePublicUrl("https://[2001:db8::1]");
});

test("isValidPublicIPv4Address()", () => {
  ok(isValidPublicIPv4Address("8.8.8.8")); // Google DNS
  ok(!isValidPublicIPv4Address("192.168.1.1")); // private
  ok(!isValidPublicIPv4Address("127.0.0.1")); // localhost
  ok(!isValidPublicIPv4Address("10.0.0.1")); // private
  ok(!isValidPublicIPv4Address("127.16.0.1")); // private
  ok(!isValidPublicIPv4Address("169.254.0.1")); // link-local
});

test("isValidPublicIPv6Address()", () => {
  ok(isValidPublicIPv6Address("2001:db8::1"));
  ok(!isValidPublicIPv6Address("::1")); // localhost
  ok(!isValidPublicIPv6Address("fc00::1")); // ULA
  ok(!isValidPublicIPv6Address("fe80::1")); // link-local
  ok(!isValidPublicIPv6Address("ff00::1")); // multicast
  ok(!isValidPublicIPv6Address("::")); // unspecified
  ok(!isValidPublicIPv6Address("::ffff:7f00:1")); // IPv4-mapped
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
});
