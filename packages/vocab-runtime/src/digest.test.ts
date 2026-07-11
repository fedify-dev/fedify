import { deepStrictEqual, equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import { addMulticodecPrefix } from "./internal/multicodec.ts";
import { encodeMultibase } from "./multibase/mod.ts";
import {
  computeDigestMultibase,
  createHashlink,
  parseDigestMultibase,
  parseHashlink,
  verifyDigestMultibase,
  verifyHashlink,
} from "./digest.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = encoder.encode("Hello World!");
// Test vector from draft-sporny-hashlink-07, appendix B.1.
const digestMultibase = "zQmWvQxTqbG2Z9HPJgG57jjwR154cKhbtJenbyYTWkjgF3e";
const hashlink = `hl:${digestMultibase}`;

test("computeDigestMultibase() computes a SHA-256 multihash", async () => {
  equal(await computeDigestMultibase(bytes), digestMultibase);
  const parsed = parseDigestMultibase(digestMultibase);
  equal(parsed.algorithm, "sha2-256");
  deepStrictEqual(
    parsed.digest,
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
});

test("digest helpers accept SharedArrayBuffer-backed bytes", async () => {
  const sharedBytes = new Uint8Array(new SharedArrayBuffer(bytes.length));
  sharedBytes.set(bytes);
  equal(await computeDigestMultibase(sharedBytes), digestMultibase);
  equal(await verifyDigestMultibase(sharedBytes, digestMultibase), true);
});

test("createHashlink() and parseHashlink() round-trip simple hashlinks", () => {
  equal(createHashlink(digestMultibase), hashlink);
  deepStrictEqual(parseHashlink(hashlink), { digestMultibase });
  deepStrictEqual(parseHashlink(new URL(hashlink)), { digestMultibase });

  const base64DigestMultibase = decoder.decode(
    encodeMultibase(
      "base64",
      addMulticodecPrefix(
        0x12,
        addMulticodecPrefix(32, new Uint8Array(32).fill(0xff)),
      ),
    ),
  );
  const base64Hashlink = createHashlink(base64DigestMultibase);
  equal(
    base64Hashlink,
    "hl:mEiD//////////////////////////////////////////w",
  );
  deepStrictEqual(parseHashlink(base64Hashlink), {
    digestMultibase: base64DigestMultibase,
  });
  deepStrictEqual(parseHashlink(new URL(base64Hashlink)), {
    digestMultibase: base64DigestMultibase,
  });
});

test("digest and hashlink verification accepts matching bytes", async () => {
  equal(await verifyDigestMultibase(bytes, digestMultibase), true);
  equal(await verifyHashlink(bytes, hashlink), true);
  equal(await verifyHashlink(bytes, new URL(hashlink)), true);
});

test("digest and hashlink verification rejects non-matching bytes", async () => {
  const different = encoder.encode("Hello World?");
  equal(await verifyDigestMultibase(different, digestMultibase), false);
  equal(await verifyHashlink(different, hashlink), false);
});

test("parseDigestMultibase() rejects unsupported algorithms", () => {
  const sha1Multihash = addMulticodecPrefix(
    0x11,
    addMulticodecPrefix(20, new Uint8Array(20)),
  );
  const value = decoder.decode(encodeMultibase("base58btc", sha1Multihash));
  throws(
    () => parseDigestMultibase(value),
    new TypeError("Unsupported digest algorithm: 0x11"),
  );
});

test("parseDigestMultibase() rejects malformed values", async () => {
  throws(
    () => parseDigestMultibase("not-multibase"),
    new TypeError("Invalid digestMultibase encoding."),
  );

  const missingLength = decoder.decode(
    encodeMultibase("base58btc", Uint8Array.of(0x12)),
  );
  throws(
    () => parseDigestMultibase(missingLength),
    new TypeError("Invalid digestMultibase multihash."),
  );

  const multihash = addMulticodecPrefix(
    0x12,
    addMulticodecPrefix(32, new Uint8Array(32)),
  );
  const padded = decoder.decode(encodeMultibase("base64pad", multihash));
  equal(padded.endsWith("=="), true);
  deepStrictEqual(parseDigestMultibase(padded).digest, new Uint8Array(32));
  throws(
    () => parseDigestMultibase(padded.slice(0, -1)),
    new TypeError("Invalid digestMultibase encoding."),
  );
  throws(
    () => createHashlink(`${padded}=`),
    new TypeError("Invalid digestMultibase encoding."),
  );

  const overlongAlgorithm = decoder.decode(
    encodeMultibase(
      "base58btc",
      Uint8Array.of(0x92, 0x00, 0x20, ...new Uint8Array(32)),
    ),
  );
  throws(
    () => parseDigestMultibase(overlongAlgorithm),
    new TypeError("Invalid digestMultibase multihash."),
  );

  const overlongLength = decoder.decode(
    encodeMultibase(
      "base58btc",
      Uint8Array.of(0x12, 0xa0, 0x00, ...new Uint8Array(32)),
    ),
  );
  throws(
    () => parseDigestMultibase(overlongLength),
    new TypeError("Invalid digestMultibase multihash."),
  );

  const shortDigest = decoder.decode(
    encodeMultibase(
      "base58btc",
      addMulticodecPrefix(0x12, addMulticodecPrefix(31, new Uint8Array(31))),
    ),
  );
  throws(
    () => parseDigestMultibase(shortDigest),
    new TypeError("Invalid SHA-256 digest length."),
  );
  await rejects(
    () => verifyDigestMultibase(bytes, shortDigest),
    new TypeError("Invalid SHA-256 digest length."),
  );
});

test("simple hashlink helpers reject metadata and malformed forms", () => {
  throws(
    () => parseHashlink(`${hashlink}:zmetadata`),
    new TypeError("Invalid simple hashlink."),
  );
  throws(
    () => parseHashlink(`https://example.com/file?hl=${digestMultibase}`),
    new TypeError("Invalid simple hashlink."),
  );
  throws(
    () => parseHashlink("hl:not-multibase"),
    new TypeError("Invalid digestMultibase encoding."),
  );
  throws(
    () => createHashlink("not-multibase"),
    new TypeError("Invalid digestMultibase encoding."),
  );
});
