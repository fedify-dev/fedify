// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { compile } from "./compile.ts";

Deno.test("opaque vs cooked vs lossless — path segment", () => {
  const t = compile("/files{/path}");

  // URL contains an encoded slash (%2F)
  const url = "/files/a%2Fb";

  const mOpaque = t.match(url, { encoding: "opaque" });
  const mCooked = t.match(url, { encoding: "cooked" });
  const mLoss = t.match(url, { encoding: "lossless" });

  if (!mOpaque || !mCooked || !mLoss) throw new Error("match failed");

  // opaque: raw percent string preserved
  assertEquals(mOpaque.vars.path, "a%2Fb");

  // cooked: one decoding pass => human-readable "a/b"
  assertEquals(mCooked.vars.path, "a/b");

  // lossless: both forms available
  assertEquals((mLoss.vars as any).path.raw, "a%2Fb");
  assertEquals((mLoss.vars as any).path.decoded, "a/b");
});

Deno.test("opaque vs cooked vs lossless — query (named, non-explode)", () => {
  const t = compile("/s{?q}");
  const url = "/s?q=a%20b";

  const mo = t.match(url, { encoding: "opaque" });
  const mc = t.match(url, { encoding: "cooked" });
  const ml = t.match(url, { encoding: "lossless" });

  if (!mo || !mc || !ml) throw new Error("match failed");

  assertEquals(mo.vars.q, "a%20b"); // opaque
  assertEquals(mc.vars.q, "a b"); // cooked
  assertEquals((ml.vars as any).q.raw, "a%20b"); // lossless
  assertEquals((ml.vars as any).q.decoded, "a b");
});

Deno.test("opaque vs cooked — fragment (# operator)", () => {
  // Note: we match against a fragment-bearing URL literal.
  const t = compile("{#frag}");
  const url = "#a%2Fb%23c"; // "a/b#c" after one decode

  const mo = t.match(url, { encoding: "opaque" });
  const mc = t.match(url, { encoding: "cooked" });

  if (!mo || !mc) throw new Error("match failed");

  assertEquals(mo.vars.frag, "a%2Fb%23c"); // raw held
  assertEquals(mc.vars.frag, "a/b#c"); // decoded once
});

Deno.test("round-trip: opaque always byte-equal; cooked not guaranteed on non-canonical URLs", () => {
  // OPAQUE: canonical URL -> byte-for-byte equality guaranteed
  {
    const t1 = compile("/repos{/owner,repo}{?q,lang}");
    const url1 = "/repos/alice/hello%2Fworld?q=a%20b&lang=en";
    const m1 = t1.match(url1, { encoding: "opaque" });
    if (!m1) throw new Error("opaque match failed");
    assertEquals(t1.expand(m1.vars as any), url1);
  }
  // COOKED: use a non-canonical URL (double-encoded %252F) to force inequality
  {
    const t2 = compile("/files{/path}");
    const url2 = "/files/a%252Fb"; // "%252F" decodes once to "%2F"
    const m2 = t2.match(url2, { encoding: "cooked" });
    if (!m2) throw new Error("cooked match failed");
    // Re-expansion encodes deterministically to "%2F", so bytes differ
    assertNotEquals(t2.expand(m2.vars as any), url2);
  }
});

Deno.test("semantic round-trip holds for cooked", () => {
  const t = compile("/u{/id}{?q}");

  // human readable vars
  const vars = { id: "a/b", q: "x y" };
  const url = t.expand(vars);

  const mc = t.match(url, { encoding: "cooked" });
  if (!mc) throw new Error("cooked match failed");

  assertEquals(mc.vars, vars);
});

Deno.test("lossless returns both forms and can re-expand either (non-canonical source)", () => {
  const t = compile("/doc{/path}{?q}");
  // both path and query contain double-encoded bytes
  const nonCanonicalUrl = "/doc/a%252Fb?q=x%2520y";
  const ml = t.match(nonCanonicalUrl, { encoding: "lossless" });
  if (!ml) throw new Error("lossless match failed");
  const { path, q } = ml.vars as any;

  // One decode step
  assertEquals(path.raw, "a%252Fb");
  assertEquals(path.decoded, "a%2Fb");
  assertEquals(q.raw, "x%2520y");
  assertEquals(q.decoded, "x%20y");
  const urlFromRaw = t.expand({ path: path.raw, q: q.raw });
  const urlFromDec = t.expand({ path: path.decoded, q: q.decoded });
  assertEquals(urlFromRaw, nonCanonicalUrl); // raw view preserves original bytes
  assertNotEquals(urlFromDec, nonCanonicalUrl); // decoded view canonicalizes bytes
});

Deno.test("strict mode: bad percent triplet fails; non-strict tolerates", () => {
  const t = compile("/x{/id}");

  const malformedPctTriplet = "/x/%GZ";

  // default strict=true -> should fail
  const mStrict = t.match(malformedPctTriplet, { encoding: "opaque" });
  assertEquals(mStrict, null);

  // strict=false -> tolerate (captures raw string including '%GZ')
  const mLenient = t.match(malformedPctTriplet, {
    encoding: "opaque",
    strict: false,
  });
  if (!mLenient) throw new Error("lenient match unexpectedly failed");
  assertEquals(mLenient.vars.id, "%GZ");
});
