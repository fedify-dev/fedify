import assert from "node:assert/strict";
import test from "node:test";
import { classifyResolvedTarget, classifyTarget } from "./tiers.ts";

test("classifyTarget - loopback", () => {
  for (
    const url of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://127.5.5.5:8080",
      "http://[::1]:8080",
      "http://app.localhost",
    ]
  ) {
    assert.strictEqual(classifyTarget(new URL(url)), "loopback", url);
  }
});

test("classifyTarget - private", () => {
  for (
    const url of [
      "http://10.0.0.5",
      "http://192.168.1.10",
      "http://172.16.0.1",
      "http://172.31.255.1",
      "http://169.254.1.1",
      "http://printer.local",
      "http://[fc00::1]",
      "http://[fd12:3456::1]",
      "http://[fe80::1]",
    ]
  ) {
    assert.strictEqual(classifyTarget(new URL(url)), "private", url);
  }
});

test("classifyTarget - public", () => {
  for (
    const url of [
      "https://example.com",
      "http://8.8.8.8",
      "http://172.32.0.1",
      "https://staging.example.org",
    ]
  ) {
    assert.strictEqual(classifyTarget(new URL(url)), "public", url);
  }
});

test("classifyTarget - IP-looking hostnames are not private", () => {
  // These are real DNS names that merely start with private-looking octets.
  for (
    const url of [
      "http://127.example.com",
      "http://10.example.com",
      "http://192.168.1.example.com",
    ]
  ) {
    assert.strictEqual(classifyTarget(new URL(url)), "public", url);
  }
});

test("classifyTarget - trailing root dot is stripped", () => {
  assert.strictEqual(classifyTarget(new URL("http://localhost./")), "loopback");
  assert.strictEqual(
    classifyTarget(new URL("http://printer.local./")),
    "private",
  );
});

test("classifyTarget - IPv4-mapped IPv6 loopback/private", () => {
  assert.strictEqual(
    classifyTarget(new URL("http://[::ffff:127.0.0.1]/")),
    "loopback",
  );
  assert.strictEqual(
    classifyTarget(new URL("http://[::ffff:10.0.0.1]/")),
    "private",
  );
});

test("classifyResolvedTarget - classifies a public hostname by resolved private address", async () => {
  const tier = await classifyResolvedTarget(
    new URL("https://bench.example"),
    () => Promise.resolve(["10.0.0.5"]),
  );
  assert.strictEqual(tier, "private");
});

test("classifyResolvedTarget - treats mixed public resolutions as public", async () => {
  const tier = await classifyResolvedTarget(
    new URL("https://bench.example"),
    () => Promise.resolve(["10.0.0.5", "8.8.8.8"]),
  );
  assert.strictEqual(tier, "public");
});

test("classifyResolvedTarget - treats resolution failure as public", async () => {
  const tier = await classifyResolvedTarget(
    new URL("https://bench.example"),
    () => Promise.reject(new Error("dns down")),
  );
  assert.strictEqual(tier, "public");
});

test("classifyResolvedTarget - treats malformed resolver output as public", async () => {
  const tier = await classifyResolvedTarget(
    new URL("https://bench.example"),
    () => Promise.resolve(["2001:db8:::1"]),
  );
  assert.strictEqual(tier, "public");
});
