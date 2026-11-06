import { test } from "@fedify/fixture";
import type { CryptographicKey, Multikey } from "@fedify/vocab";
import type {
  AuthenticatedDocumentLoaderFactory,
  CryptoKeyLike,
  CryptoKeyPairLike,
  exportMultibaseKey,
  exportSpki,
} from "@fedify/vocab-runtime";
import type { ActorKeyPairsDispatcher } from "../federation/callback.ts";
import type { Context } from "../federation/context.ts";
import type {
  ActorCallbackSetters,
  InboxListenerSetters,
} from "../federation/federation.ts";
import type { SenderKeyPair } from "../federation/send.ts";
import type { getAuthenticatedDocumentLoader } from "../utils/docloader.ts";
import type { signRequest } from "./http.ts";
import type { createSignature, signJsonLd } from "./ld.ts";
import type { createProof, signObject } from "./proof.ts";
import type { exportJwk } from "./key.ts";

/**
 * Asserts at compile time that `T` is assignable to `U`.
 */
type AssertAssignable<T extends U, U> = T;

/**
 * The key usages Node.js adds on top of the DOM and Web Worker ones since
 * Node.js 24.7, when ML-KEM support was added to its Web Crypto API.
 */
type NodeKeyUsage =
  | KeyUsage
  | "encapsulateBits"
  | "decapsulateBits"
  | "encapsulateKey"
  | "decapsulateKey";

/**
 * Mirrors `import("node:crypto").webcrypto.CryptoKey`, whose `usages` array
 * has a wider element type than the ambient `CryptoKey`.
 */
interface NodeCryptoKey extends Omit<CryptoKey, "usages"> {
  readonly usages: NodeKeyUsage[];
}

/**
 * Mirrors `import("node:crypto").webcrypto.CryptoKeyPair`.
 */
interface NodeCryptoKeyPair {
  readonly privateKey: NodeCryptoKey;
  readonly publicKey: NodeCryptoKey;
}

/**
 * These are compile-time assertions.  A regression in any of the public
 * signatures fails `deno check` even though nothing here runs.
 */
export type NodeKeyTypeChecks = [
  AssertAssignable<NodeCryptoKey, CryptoKeyLike>,
  AssertAssignable<NodeCryptoKeyPair, CryptoKeyPairLike>,
  AssertAssignable<
    (
      context: Context<void>,
      identifier: string,
    ) => NodeCryptoKeyPair[] | Promise<NodeCryptoKeyPair[]>,
    ActorKeyPairsDispatcher<void, CryptoKeyPairLike>
  >,
  AssertAssignable<
    ActorKeyPairsDispatcher<void, CryptoKeyPairLike>,
    Parameters<ActorCallbackSetters<void>["setKeyPairsDispatcher"]>[0]
  >,
  AssertAssignable<SenderKeyPair["privateKey"], CryptoKey>,
  AssertAssignable<NodeCryptoKey, SenderKeyPair<CryptoKeyLike>["privateKey"]>,
  AssertAssignable<
    (context: Context<void>) => SenderKeyPair<CryptoKeyLike>,
    Parameters<InboxListenerSetters<void>["setSharedKeyDispatcher"]>[0]
  >,
  AssertAssignable<
    Parameters<AuthenticatedDocumentLoaderFactory>[0]["privateKey"],
    CryptoKey
  >,
  AssertAssignable<
    NodeCryptoKey,
    Parameters<typeof getAuthenticatedDocumentLoader>[0]["privateKey"]
  >,
  AssertAssignable<NodeCryptoKey, Parameters<typeof signRequest>[1]>,
  AssertAssignable<NodeCryptoKey, Parameters<typeof createProof>[1]>,
  AssertAssignable<NodeCryptoKey, Parameters<typeof signObject>[1]>,
  AssertAssignable<NodeCryptoKey, Parameters<typeof createSignature>[1]>,
  AssertAssignable<NodeCryptoKey, Parameters<typeof signJsonLd>[1]>,
  AssertAssignable<NodeCryptoKey, Parameters<typeof exportJwk>[0]>,
  AssertAssignable<NodeCryptoKey, Parameters<typeof exportSpki>[0]>,
  AssertAssignable<NodeCryptoKey, Parameters<typeof exportMultibaseKey>[0]>,
  AssertAssignable<
    NodeCryptoKey,
    NonNullable<
      ConstructorParameters<typeof CryptographicKey>[0]["publicKey"]
    >
  >,
  AssertAssignable<
    NodeCryptoKey,
    NonNullable<ConstructorParameters<typeof Multikey>[0]["publicKey"]>
  >,
  AssertAssignable<
    NodeCryptoKey,
    NonNullable<
      NonNullable<Parameters<CryptographicKey["clone"]>[0]>["publicKey"]
    >
  >,
  AssertAssignable<
    NodeCryptoKey,
    NonNullable<NonNullable<Parameters<Multikey["clone"]>[0]>["publicKey"]>
  >,
];

test("Node.js Web Crypto keys are accepted by the public key types", () => {
  // The actual assertions are the type aliases above; this keeps the test
  // runner from dropping a file that contains only type-level checks.
});
