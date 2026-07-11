import {
  addMulticodecPrefix,
  getMulticodecPrefix,
} from "./internal/multicodec.ts";
import {
  decodeMultibase,
  encodeMultibase,
  encodingFromBaseData,
} from "./multibase/mod.ts";

const SHA2_256_MULTIHASH_CODE = 0x12;
const SHA2_256_DIGEST_LENGTH = 32;
const textDecoder = new TextDecoder();
const getArrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function isCanonicalVarintPrefix(
  data: Uint8Array,
  prefix: ReturnType<typeof getMulticodecPrefix>,
): boolean {
  const canonical = addMulticodecPrefix(prefix.code, new Uint8Array());
  if (canonical.length !== prefix.prefixLength) return false;
  for (let i = 0; i < canonical.length; i++) {
    if (data[i] !== canonical[i]) return false;
  }
  return true;
}

function toWebCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (getArrayBufferByteLength != null) {
    try {
      getArrayBufferByteLength.call(bytes.buffer);
      return bytes as Uint8Array<ArrayBuffer>;
    } catch {
      // SharedArrayBuffer input needs to be copied for Web Crypto.
    }
  }
  return new Uint8Array(bytes);
}

/**
 * A parsed SHA-256 resource digest.
 *
 * @since 2.4.0
 */
export interface ParsedDigestMultibase {
  /** The multihash algorithm represented by the digest. */
  readonly algorithm: "sha2-256";

  /** The raw 32-byte SHA-256 digest. */
  readonly digest: Uint8Array;
}

/**
 * A parsed simple hashlink.
 *
 * @since 2.4.0
 */
export interface ParsedHashlink {
  /** The multibase-encoded multihash carried by the hashlink. */
  readonly digestMultibase: string;
}

/**
 * Computes the SHA-256 digest of a byte sequence and encodes it as a
 * base58-btc multibase multihash suitable for FEP-ef61's
 * `digestMultibase` property.
 *
 * @param bytes The bytes to digest.
 * @returns The base58-btc multibase-encoded SHA-256 multihash.
 * @since 2.4.0
 */
export async function computeDigestMultibase(
  bytes: Uint8Array,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toWebCryptoBytes(bytes)),
  );
  const lengthAndDigest = addMulticodecPrefix(digest.length, digest);
  const multihash = addMulticodecPrefix(
    SHA2_256_MULTIHASH_CODE,
    lengthAndDigest,
  );
  return textDecoder.decode(encodeMultibase("base58btc", multihash));
}

/**
 * Parses and validates a SHA-256 `digestMultibase` value.
 *
 * @param value The multibase-encoded multihash to parse.
 * @returns The digest algorithm and raw digest bytes.
 * @throws {TypeError} If the value is malformed or uses an unsupported hash
 *                      algorithm.
 * @since 2.4.0
 */
export function parseDigestMultibase(value: string): ParsedDigestMultibase {
  let multihash: Uint8Array;
  try {
    multihash = decodeMultibase(value);
  } catch (error) {
    throw new TypeError("Invalid digestMultibase encoding.", { cause: error });
  }
  const encoding = encodingFromBaseData(value);
  const canonicalValue = textDecoder.decode(
    encodeMultibase(encoding.name, multihash),
  );
  if (value !== canonicalValue) {
    throw new TypeError("Invalid digestMultibase encoding.");
  }

  let algorithmPrefix: ReturnType<typeof getMulticodecPrefix>;
  try {
    algorithmPrefix = getMulticodecPrefix(multihash);
  } catch (error) {
    throw new TypeError("Invalid digestMultibase multihash.", { cause: error });
  }
  if (!isCanonicalVarintPrefix(multihash, algorithmPrefix)) {
    throw new TypeError("Invalid digestMultibase multihash.");
  }
  if (algorithmPrefix.code !== SHA2_256_MULTIHASH_CODE) {
    throw new TypeError(
      `Unsupported digest algorithm: 0x${algorithmPrefix.code.toString(16)}`,
    );
  }

  const lengthAndDigest = multihash.subarray(algorithmPrefix.prefixLength);
  let lengthPrefix: ReturnType<typeof getMulticodecPrefix>;
  try {
    lengthPrefix = getMulticodecPrefix(lengthAndDigest);
  } catch (error) {
    throw new TypeError("Invalid digestMultibase multihash.", { cause: error });
  }
  if (!isCanonicalVarintPrefix(lengthAndDigest, lengthPrefix)) {
    throw new TypeError("Invalid digestMultibase multihash.");
  }
  const digest = lengthAndDigest.slice(lengthPrefix.prefixLength);
  if (
    lengthPrefix.code !== SHA2_256_DIGEST_LENGTH ||
    digest.length !== SHA2_256_DIGEST_LENGTH
  ) {
    throw new TypeError("Invalid SHA-256 digest length.");
  }
  return { algorithm: "sha2-256", digest };
}

function extractDigestMultibase(value: string | URL): string {
  const hashlink = typeof value === "string" ? value : value.href;
  const match = /^hl:([^:\r\n\u2028\u2029]+)$/i.exec(hashlink);
  if (match == null || match[0].length !== hashlink.length) {
    throw new TypeError("Invalid simple hashlink.");
  }
  return match[1];
}

/**
 * Parses a metadata-free `hl:` hashlink and validates its resource digest.
 *
 * @param value The simple hashlink to parse.
 * @returns The `digestMultibase` value carried by the hashlink.
 * @throws {TypeError} If the hashlink is malformed, contains metadata, or
 *                      carries an invalid or unsupported digest.
 * @since 2.4.0
 */
export function parseHashlink(value: string | URL): ParsedHashlink {
  const digestMultibase = extractDigestMultibase(value);
  parseDigestMultibase(digestMultibase);
  return { digestMultibase };
}

/**
 * Creates a metadata-free `hl:` hashlink from a `digestMultibase` value.
 *
 * @param digestMultibase The SHA-256 multibase multihash to embed.
 * @returns The simple hashlink.
 * @throws {TypeError} If the digest is malformed or unsupported.
 * @since 2.4.0
 */
export function createHashlink(digestMultibase: string): string {
  parseDigestMultibase(digestMultibase);
  return `hl:${digestMultibase}`;
}

/**
 * Verifies that bytes match a SHA-256 `digestMultibase` value.
 *
 * @param bytes The bytes to verify.
 * @param digestMultibase The expected digest.
 * @returns Whether the bytes match the digest.
 * @throws {TypeError} If the digest is malformed or unsupported.
 * @since 2.4.0
 */
export async function verifyDigestMultibase(
  bytes: Uint8Array,
  digestMultibase: string,
): Promise<boolean> {
  const expected = parseDigestMultibase(digestMultibase).digest;
  const actual = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toWebCryptoBytes(bytes)),
  );
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected[i] ^ actual[i];
  }
  return difference === 0;
}

/**
 * Verifies that bytes match the resource digest in a simple hashlink.
 *
 * @param bytes The bytes to verify.
 * @param hashlink The simple hashlink containing the expected digest.
 * @returns Whether the bytes match the hashlink digest.
 * @throws {TypeError} If the hashlink or digest is malformed or unsupported.
 * @since 2.4.0
 */
export async function verifyHashlink(
  bytes: Uint8Array,
  hashlink: string | URL,
): Promise<boolean> {
  const digestMultibase = extractDigestMultibase(hashlink);
  return await verifyDigestMultibase(bytes, digestMultibase);
}
