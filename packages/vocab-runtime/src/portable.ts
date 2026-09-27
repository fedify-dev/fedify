import type { TracerProvider } from "@opentelemetry/api";
import type { DocumentLoader } from "./docloader.ts";

/**
 * Options passed to a {@link PortableObjectVerifier}.
 * @since 2.4.0
 */
export interface PortableObjectVerifierOptions {
  /**
   * The document loader for fetching remote documents, such as verification
   * methods that are not `did:key` URLs.
   */
  readonly documentLoader?: DocumentLoader;

  /**
   * The document loader for fetching remote JSON-LD contexts.  During
   * gateway dereferencing, this loader returns the same context documents
   * that the vocabulary parser sees.
   */
  readonly contextLoader?: DocumentLoader;

  /**
   * The OpenTelemetry tracer provider.
   */
  readonly tracerProvider?: TracerProvider;
}

/**
 * A function that applies the [FEP-ef61] proof policy to a portable object
 * fetched through a gateway.
 *
 * It receives the fetched JSON-LD document as is, and resolves to an object
 * whose `verified` property tells whether the document carries a valid
 * [FEP-8b32] Object Integrity Proof made by the DID in its portable ID.
 * `verifyPortableObjectProof()` from `@fedify/fedify` satisfies this type, so
 * it can be passed as the `verifyPortableObject` option of generated
 * vocabulary accessors such as `Activity.getObject()`.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * [FEP-8b32]: https://w3id.org/fep/8b32
 *
 * @param document The fetched JSON-LD document.
 * @param options Loaders and tracing options for verification.
 * @returns An object whose `verified` property is `true` if and only if the
 *          document satisfies the proof policy.  Other properties, such as
 *          a failure reason, are logged when verification fails.
 * @since 2.4.0
 */
export type PortableObjectVerifier = (
  document: unknown,
  options: PortableObjectVerifierOptions,
) => Promise<{ readonly verified: boolean }>;
