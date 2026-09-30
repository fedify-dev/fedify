import type { VerifyPortableObjectFailureReason } from "@fedify/fedify";
import {
  lookupObject,
  type LookupObjectOptions,
  type Object as APObject,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  FetchError,
  formatIri,
  UrlError,
} from "@fedify/vocab-runtime";
import {
  type CliPortableObjectVerifier,
  createPortableObjectVerifier,
  getPortableLookupProblem,
  isPortableReference,
} from "./portable.ts";

/** A loader failure retained by the CLI, including where it occurred. */
export interface LookupFailure {
  error: unknown;
  source: "object" | "context" | "portable" | "other";
  /**
   * The ID of the [FEP-ef61] portable object that was rejected, if the
   * source is `"portable"`.
   *
   * [FEP-ef61]: https://w3id.org/fep/ef61
   */
  id?: string;
  /** Why the portable object was rejected, if the verifier told it. */
  reason?: VerifyPortableObjectFailureReason;
  /** Why the portable object could not be looked up at all. */
  problem?: "malformed" | "no-gateway";
}

/**
 * Records loader failures that lookupObject would otherwise swallow or wrap,
 * and portable objects that the verifier rejects.
 * @param documentLoader The document loader to record failures of.
 * @param contextLoader The context loader to record failures of.
 * @param verifierDocumentLoader The document loader for the documents that
 *                               the [FEP-ef61] portable object verifier
 *                               discovers.  If omitted, the returned
 *                               `verifyPortableObject` is `undefined`.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 */
export function createLookupDiagnostics(
  documentLoader: DocumentLoader,
  contextLoader: DocumentLoader,
  verifierDocumentLoader?: DocumentLoader,
) {
  let objectFailure: LookupFailure | undefined;
  let contextFailure: LookupFailure | undefined;
  let portableFailure: LookupFailure | undefined;
  // The loader failures during the ongoing verification, if any:
  let verificationFailures: LookupFailure[] | undefined;
  const wrap = (
    loader: DocumentLoader,
    source: "object" | "context",
    record: (failure: LookupFailure | undefined) => void,
  ): DocumentLoader =>
  async (url, options) => {
    try {
      const document = await loader(url, options);
      record(undefined);
      // A failure that the verifier recovered from is not why it failed:
      if (verificationFailures != null) verificationFailures.length = 0;
      return document;
    } catch (error) {
      const failure = { error, source };
      record(failure);
      verificationFailures?.push(failure);
      throw error;
    }
  };
  const recordObjectFailure = (failure: LookupFailure | undefined) =>
    objectFailure = failure;
  const wrappedContextLoader = wrap(
    contextLoader,
    "context",
    (e) => contextFailure = e,
  );
  const verifyPortableObject = verifierDocumentLoader == null
    ? undefined
    : createPortableObjectVerifier(
      wrap(verifierDocumentLoader, "object", recordObjectFailure),
      wrappedContextLoader,
    );
  const verify: CliPortableObjectVerifier | undefined =
    verifyPortableObject == null ? undefined : async (document, options) => {
      const id = getDocumentId(document);
      const failures: LookupFailure[] = [];
      verificationFailures = failures;
      try {
        const result = await verifyPortableObject(document, options);
        if (result.verified) {
          portableFailure = undefined;
        } else if (
          result.reason.type === "collectionOwnerUnavailable" &&
          failures.length > 0
        ) {
          // Report why the owner could not be retrieved, e.g., a timeout:
          portableFailure = failures[failures.length - 1];
        } else {
          portableFailure = {
            error: undefined,
            source: "portable",
            id,
            reason: result.reason,
          };
        }
        return result;
      } catch (error) {
        portableFailure = { error, source: "portable", id };
        throw error;
      } finally {
        verificationFailures = undefined;
      }
    };
  return {
    documentLoader: wrap(documentLoader, "object", recordObjectFailure),
    contextLoader: wrappedContextLoader,
    verifyPortableObject: verify,
    clearFailures() {
      objectFailure = undefined;
      contextFailure = undefined;
      portableFailure = undefined;
    },
    getObjectFailure: () => objectFailure,
    getContextFailure: () => contextFailure,
    getPortableFailure: () => portableFailure,
  };
}

function getDocumentId(document: unknown): string | undefined {
  if (document == null || typeof document !== "object") return undefined;
  const record = document as Record<string, unknown>;
  const id = record.id ?? record["@id"];
  return typeof id === "string" ? formatIdentifier(id) : undefined;
}

interface LookupResult {
  readonly object: APObject | null;
  readonly failure?: LookupFailure;
  readonly thrownError?: unknown;
}

/** Returns an object and a snapshot of the evidence for a failed lookup. */
export async function lookupWithDiagnostics(
  identifier: string | URL,
  options: LookupObjectOptions & {
    documentLoader: DocumentLoader;
    contextLoader: DocumentLoader;
    /**
     * The document loader for the documents that the [FEP-ef61] portable
     * object verifier discovers.  If omitted, portable objects are not
     * looked up.
     *
     * [FEP-ef61]: https://w3id.org/fep/ef61
     */
    verifierDocumentLoader?: DocumentLoader;
  },
  lookup: typeof lookupObject = lookupObject,
): Promise<LookupResult> {
  const { verifierDocumentLoader, ...lookupOptions } = options;
  if (verifierDocumentLoader != null) {
    const problem = getPortableLookupProblem(identifier, options.gateways);
    if (problem != null) {
      return Object.freeze({
        object: null,
        failure: {
          error: undefined,
          source: "portable" as const,
          id: formatIdentifier(identifier),
          problem,
        },
      });
    }
  }
  const diagnostics = createLookupDiagnostics(
    options.documentLoader,
    options.contextLoader,
    verifierDocumentLoader,
  );
  try {
    const object = await lookup(identifier, {
      ...lookupOptions,
      documentLoader: diagnostics.documentLoader,
      contextLoader: diagnostics.contextLoader,
      ...(diagnostics.verifyPortableObject == null
        ? {}
        : { verifyPortableObject: diagnostics.verifyPortableObject }),
    });
    if (object != null) return Object.freeze({ object });
    return Object.freeze({
      object,
      failure: diagnostics.getPortableFailure() ??
        diagnostics.getObjectFailure() ??
        diagnostics.getContextFailure() ??
        (verifierDocumentLoader != null && isPortableReference(identifier)
          ? {
            error: undefined,
            source: "portable" as const,
            id: formatIdentifier(identifier),
          }
          : undefined),
    });
  } catch (error) {
    return Object.freeze({
      object: null,
      thrownError: error,
      failure: diagnostics.getContextFailure() ??
        diagnostics.getObjectFailure() ??
        diagnostics.getPortableFailure() ?? {
        error,
        source: "other" as const,
      },
    });
  }
}

function formatIdentifier(identifier: string | URL): string {
  try {
    return formatIri(identifier);
  } catch {
    return typeof identifier === "string" ? identifier : identifier.href;
  }
}

const PORTABLE_REJECTION_REASONS: Record<
  VerifyPortableObjectFailureReason["type"],
  string
> = {
  notPortableObject: "it has neither a portable ID nor a compatible identifier",
  unsupportedObjectType: "its type cannot be a portable object",
  missingProof: "it has no integrity proof",
  invalidGateways: "its gateways property is missing or invalid",
  invalidProof: "its integrity proof is invalid",
  unsupportedVerificationMethod:
    "its integrity proof has an unsupported verification method",
  verificationMethodMismatch:
    "its integrity proof was not created by the DID in its ID",
  unknownCollectionSource:
    "it is a collection without an integrity proof that was not served by " +
    "a gateway",
  unknownCollectionOwner:
    "it is a collection without an integrity proof whose owner is unknown",
  conflictingCollectionOwners:
    "it is a collection without an integrity proof whose owner is ambiguous",
  collectionPageMismatch:
    "it is a collection page that does not belong to its collection",
  collectionOwnerUnavailable:
    "it is a collection without an integrity proof whose owner could not " +
    "be retrieved",
  collectionNotListedByOwner:
    "it is a collection without an integrity proof that its owner does not " +
    "list",
  untrustedGateway:
    "it is a collection without an integrity proof served by a gateway that " +
    "its owner does not list",
};

function describePortableFailure(failure: LookupFailure): string {
  const id = failure.id ?? "(unknown)";
  if (failure.problem === "malformed") {
    return `Invalid portable ID: ${id}.`;
  }
  if (failure.problem === "no-gateway") {
    return `The portable ID ${id} has no @gateway location hints.  ` +
      "Use the --gateway option to look it up.";
  }
  if (failure.reason != null) {
    const reason = PORTABLE_REJECTION_REASONS[failure.reason.type] ??
      failure.reason.type;
    return `Rejected the portable object ${id}, as ${reason}.`;
  }
  if (failure.error != null) {
    const error = failure.error instanceof Error
      ? failure.error.message
      : String(failure.error);
    return `Failed to verify the portable object ${id}: ${error}`;
  }
  return `No gateway returned a valid portable object for ${id}.`;
}

// Parse errors can quote remote document bytes. Keep them from controlling
// the terminal when displaying a diagnostic.
function escapeControlCharacters(message: string): string {
  return message.replace(
    // deno-lint-ignore no-control-regex
    /[\x00-\x1f\x7f-\x9f]/g,
    (character) =>
      `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

/** Describes a failure without recommending signing unless HTTP supports it. */
export function describeLookupFailure(
  failure: LookupFailure | undefined,
  authorizedFetch: boolean,
): { message: string; suggestsAuthorizedFetch: boolean } {
  if (failure?.source === "portable") {
    return {
      message: escapeControlCharacters(describePortableFailure(failure)),
      suggestsAuthorizedFetch: false,
    };
  }
  const error = failure?.error;
  // FetchError has no status field. Match only the loader's exact format,
  // using the raw URL twice rather than its potentially normalized URL.href.
  const http = error instanceof FetchError
    ? /^(.+): HTTP (\d{3}): \1$/s.exec(error.message)
    : null;
  if (http != null) {
    const status = Number(http[2]);
    const suggestsAuthorizedFetch = failure?.source === "object" &&
      !authorizedFetch && [401, 403, 404].includes(status);
    return {
      message: escapeControlCharacters(`HTTP ${status} from ${http[1]}.`) +
        (suggestsAuthorizedFetch
          ? "  It may be a private object.  Try with -a/--authorized-fetch."
          : ""),
      suggestsAuthorizedFetch,
    };
  }
  const causes: Error[] = [];
  const seen = new Set<unknown>();
  let cause = error;
  while (cause instanceof Error && !seen.has(cause) && causes.length < 8) {
    seen.add(cause);
    causes.push(cause);
    if (
      cause instanceof UrlError && cause.reason === "dns" ||
      cause instanceof TypeError &&
        /dns error|failed to lookup address information/i.test(cause.message) ||
      "code" in cause &&
        (cause.code === "ENOTFOUND" || cause.code === "EAI_AGAIN")
    ) {
      return {
        message:
          "Could not resolve the host in the URL.  Check the URL and your network connection.",
        suggestsAuthorizedFetch: false,
      };
    }
    cause = cause.cause;
  }
  return {
    message: escapeControlCharacters(
      causes.length > 0
        ? causes.map((e) => e.message).join(": ")
        : error == null
        ? "Could not fetch or parse the object.  Check the URL or actor handle."
        : String(error),
    ),
    suggestsAuthorizedFetch: false,
  };
}
