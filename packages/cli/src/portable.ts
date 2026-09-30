import {
  verifyPortableObject,
  type VerifyPortableObjectResult,
} from "@fedify/fedify";
import {
  canonicalizePortableUri,
  type DocumentLoader,
  formatIri,
  fromCompatibleEf61Id,
  getGatewayHints,
  isGatewayUrl,
  parseIri,
  type PortableObjectVerifierOptions,
} from "@fedify/vocab-runtime";
import { message, type ValueParser } from "@optique/core";

/**
 * A [FEP-ef61] portable object verifier that also reports why a document
 * was rejected.  It is assignable to `PortableObjectVerifier`.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export type CliPortableObjectVerifier = (
  document: unknown,
  options: PortableObjectVerifierOptions,
) => Promise<VerifyPortableObjectResult>;

const PORTABLE_IRI_PATTERN = /^ap(?:\+ef61)?:/i;

/**
 * Checks whether the identifier is an [FEP-ef61] portable `ap:` or
 * `ap+ef61:` ID.  It does not check whether the ID is well-formed.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export function isPortableIdentifier(identifier: string | URL): boolean {
  return PORTABLE_IRI_PATTERN.test(
    typeof identifier === "string" ? identifier : identifier.protocol,
  );
}

/**
 * Checks whether the identifier is an [FEP-ef61] portable ID or looks like
 * a compatible identifier, i.e., whether `lookupObject()` looks it up
 * through gateways.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export function isPortableReference(identifier: string | URL): boolean {
  if (isPortableIdentifier(identifier)) return true;
  try {
    return fromCompatibleEf61Id(identifier) != null;
  } catch (error) {
    // A malformed compatible identifier:
    if (error instanceof TypeError) return true;
    throw error;
  }
}

/**
 * Tells why a portable ID cannot be looked up before asking any server.
 * @param identifier The identifier to look up.
 * @param gateways The gateways given with `--gateway`, if any.
 * @returns `"malformed"` if the identifier is a malformed portable ID,
 *          `"no-gateway"` if it is a portable ID without `@gateway` location
 *          hints and no gateways are given, or `null` otherwise.
 */
export function getPortableLookupProblem(
  identifier: string | URL,
  gateways?: readonly (string | URL)[],
): "malformed" | "no-gateway" | null {
  if (!isPortableIdentifier(identifier)) return null;
  let hints: URL[];
  try {
    parseIri(identifier);
    hints = getGatewayHints(identifier);
  } catch (error) {
    if (error instanceof TypeError) return "malformed";
    throw error;
  }
  if (hints.length > 0 || gateways != null && gateways.length > 0) {
    return null;
  }
  return "no-gateway";
}

/**
 * Computes a key to compare IRIs with.  An [FEP-ef61] portable ID or
 * compatible identifier is turned into its canonical form, which ignores
 * the scheme spelling, the percent-encoding of the DID, the gateway of
 * a compatible identifier, and the query (e.g., `@gateway` location hints).
 * Other IRIs are compared by their normalized URLs.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param iri The IRI.  Pass the raw string as given if available, since
 *            parsing it as a `URL` may change the object it identifies.
 * @returns The key, or `null` if the IRI is malformed.
 */
export function getIriKey(iri: string | URL): string | null {
  try {
    const raw = typeof iri === "string" ? iri : formatIri(iri);
    if (isPortableIdentifier(raw)) return canonicalizePortableUri(raw);
    const portable = fromCompatibleEf61Id(iri);
    if (portable != null) return canonicalizePortableUri(formatIri(portable));
    return (typeof iri === "string" ? new URL(iri) : iri).href;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * Creates the [FEP-ef61] portable object verifier that the CLI uses.
 *
 * The verifier always fetches documents, such as the owner of an unsecured
 * collection, with the given document loader rather than the one passed by
 * the caller, since `lookupObject()` passes its own loader, which may allow
 * private addresses for the objects explicitly given on the command line.
 * @param documentLoader The document loader for the documents that the
 *                       verifier discovers.
 * @param contextLoader The context loader to use when the caller passes
 *                      none.
 * @returns The verifier.
 */
export function createPortableObjectVerifier(
  documentLoader: DocumentLoader,
  contextLoader: DocumentLoader,
): CliPortableObjectVerifier {
  return (document, options) =>
    verifyPortableObject(document, {
      ...options,
      documentLoader,
      contextLoader: options.contextLoader ?? contextLoader,
    });
}

/**
 * A value parser for the `--gateway` option, which accepts an [FEP-ef61]
 * gateway, i.e., an HTTP(S) origin without credentials, path, query, or
 * fragment.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export function gatewayUrl(): ValueParser<"sync", URL> {
  return {
    mode: "sync",
    metavar: "GATEWAY",
    placeholder: new URL("https://gateway.invalid/"),
    parse(input) {
      let url: URL;
      try {
        url = parseIri(input);
      } catch {
        return { success: false, error: message`Invalid URL: ${input}.` };
      }
      if (!isGatewayUrl(url)) {
        return {
          success: false,
          error: message`Invalid gateway: ${input}.  A gateway must be \
an HTTP(S) origin without credentials, path, query, or fragment, \
e.g., ${"https://example.com"}.`,
        };
      }
      return { success: true, value: url };
    },
    format(value) {
      return value.href;
    },
  };
}
