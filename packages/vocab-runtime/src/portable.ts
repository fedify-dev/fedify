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

  /**
   * The URL the document was finally retrieved from, i.e., the `documentUrl`
   * of the document loader's result, which may differ from the requested URL
   * after redirects.  Trust decisions such as the [FEP-ef61] gateway trust
   * policy for unsecured collections depend on it, so custom document loaders
   * must report it truthfully.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   * @since 2.4.0
   */
  readonly documentUrl?: URL;

  /**
   * The gateways that the caller explicitly passed to the accessor through
   * its `gateways` option, in order.  It is `undefined` if the caller did not
   * pass the option, and can be empty.
   * @since 2.4.0
   */
  readonly gateways?: readonly URL[];

  /**
   * The gateways taken from the `@gateway` location hints of the reference,
   * in order, when the caller did not pass the `gateways` option.
   * @since 2.4.0
   */
  readonly gatewayHints?: readonly URL[];

  /**
   * The object whose property referred to the document, if the document was
   * dereferenced through a property accessor.
   * @since 2.4.0
   */
  readonly referrer?: PortableObjectReferrer;
}

/**
 * An object whose property referred to a portable object being verified.
 * Referrers form a chain: {@link PortableObjectReferrer.referrer} is the
 * object through which this referrer itself was obtained, and so on.
 * @since 2.4.0
 */
export interface PortableObjectReferrer {
  /**
   * The referring vocabulary object.
   */
  readonly object: unknown;

  /**
   * The `@id` of the referring object, if any.
   */
  readonly id: URL | null;

  /**
   * The expanded URI of the property through which the referring object
   * referred to the next object in the chain, e.g.,
   * `https://www.w3.org/ns/activitystreams#outbox`.
   */
  readonly property: string;

  /**
   * How the referring object itself was accepted by a
   * {@link PortableObjectVerifier} when it was dereferenced through gateways:
   *
   * - `"verified"`: accepted as verified, e.g., with a valid integrity proof.
   * - `"unsecured"`: accepted without an integrity proof, e.g., as an
   *   unsecured collection served by a trusted gateway.
   *
   * It is `undefined` if the referring object was not dereferenced through
   * gateways, e.g., if it was embedded in another object or constructed by
   * the application.
   */
  readonly acceptance?: "verified" | "unsecured";

  /**
   * The opaque collection context that a {@link PortableObjectVerifier}
   * attached to the referring object when it accepted it.  See
   * {@link PortableObjectVerification}.
   */
  readonly collectionContext?: unknown;

  /**
   * The referrer of the referring object, if any.
   */
  readonly referrer?: PortableObjectReferrer;

  /**
   * Whether the chain was cut off here because it was too long.  If `true`,
   * the referring object may have a referrer which is not included.
   */
  readonly truncated?: boolean;
}

/**
 * The result of a {@link PortableObjectVerifier}.
 * @since 2.4.0
 */
export type PortableObjectVerification =
  | {
    /** Whether the document is accepted. */
    readonly verified: false;
  }
  | {
    /** Whether the document is accepted. */
    readonly verified: true;

    /**
     * Whether the document was accepted without an integrity proof, e.g., as
     * an unsecured [FEP-ef61] collection served by a gateway that its owner
     * lists.  Objects embedded in such a document are not trusted because of
     * their origin; property accessors dereference and verify them one by
     * one instead.
     *
     * [FEP-ef61]: https://w3id.org/fep/ef61
     */
    readonly unsecured?: boolean;

    /**
     * An opaque value that the verifier wants to receive again as
     * {@link PortableObjectReferrer.collectionContext} when objects referred
     * to by this document, such as collection pages, are verified.
     */
    readonly collectionContext?: unknown;
  };

/**
 * A function that applies the [FEP-ef61] trust policy to a portable object
 * fetched through a gateway.
 *
 * It receives the fetched JSON-LD document as is, and resolves to an object
 * whose `verified` property tells whether the document is acceptable, e.g.,
 * whether it carries a valid [FEP-8b32] Object Integrity Proof made by the
 * DID in its portable ID.  `verifyPortableObject()` and
 * `verifyPortableObjectProof()` from `@fedify/fedify` satisfy this type, so
 * they can be passed as the `verifyPortableObject` option of generated
 * vocabulary accessors such as `Activity.getObject()`.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * [FEP-8b32]: https://w3id.org/fep/8b32
 *
 * @param document The fetched JSON-LD document.
 * @param options Loaders, tracing options, and where the document came from.
 * @returns An object whose `verified` property is `true` if and only if the
 *          document satisfies the policy.  Other properties, such as
 *          a failure reason, are logged when verification fails.
 * @since 2.4.0
 */
export type PortableObjectVerifier = (
  document: unknown,
  options: PortableObjectVerifierOptions,
) => Promise<PortableObjectVerification>;
