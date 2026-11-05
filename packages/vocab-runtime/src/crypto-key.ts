/**
 * Structural representations of the Web Cryptography API key types, used for
 * parameters that accept keys from any supported runtime.
 *
 * @module
 */

/**
 * A structural representation of a Web Cryptography API `CryptoKey`.
 *
 * Fedify accepts this shape instead of the ambient `CryptoKey` type wherever a
 * key is supplied by the application.  The ambient type depends on the
 * consumer's `lib` setting, and `node:crypto`'s `CryptoKey` has been
 * incompatible with the DOM and Web Worker ones since `@types/node` 24.7.0,
 * which added the ML-KEM key usages to `webcrypto.KeyUsage`.  Widening the
 * input to this interface lets keys from Deno, Node.js, Bun, and Cloudflare
 * Workers reach the same APIs.
 *
 * The keys are still native `CryptoKey` objects at run time; Fedify narrows
 * them internally before calling `crypto.subtle` and validates them with
 * {@link validateCryptoKey}.
 * @since 2.0.36
 */
export interface CryptoKeyLike {
  /**
   * The algorithm the key was generated for, along with any parameters.
   */
  readonly algorithm: { readonly name: string };

  /**
   * Whether the key can be exported with `crypto.subtle.exportKey()`.
   */
  readonly extractable: boolean;

  /**
   * Whether the key is a private, public, or secret key.
   *
   * This is a plain `string` rather than a union of the known values because
   * `@cloudflare/workers-types` declares it as `string`, and a narrower type
   * would reject keys from the Workers runtime.
   */
  readonly type: string;

  /**
   * The operations the key may be used for.
   *
   * The element type is `string` for the same reason as {@link type}: Node.js
   * and the DOM declare different sets of usages, and each set grows over time.
   */
  readonly usages: readonly string[];
}

/**
 * A structural representation of a Web Cryptography API `CryptoKeyPair`.
 *
 * See {@link CryptoKeyLike} for why Fedify takes this instead of the ambient
 * `CryptoKeyPair` type on parameters.
 * @since 2.0.36
 */
export interface CryptoKeyPairLike {
  /**
   * The private key of the pair.
   */
  readonly privateKey: CryptoKeyLike;

  /**
   * The public key of the pair.
   */
  readonly publicKey: CryptoKeyLike;
}

/**
 * Narrows a {@link CryptoKeyLike} to the ambient `CryptoKey` type, for passing
 * it to `crypto.subtle` or to APIs that still declare the ambient type.
 *
 * This is internal to Fedify and is not exported from the package entry point.
 * @param key The key to narrow.
 * @returns The same key, typed as the ambient `CryptoKey`.
 */
export function asCryptoKey(key: CryptoKeyLike): CryptoKey {
  return key as unknown as CryptoKey;
}
