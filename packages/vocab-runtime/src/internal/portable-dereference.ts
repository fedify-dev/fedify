import { getLogger } from "@logtape/logtape";
import {
  type Span,
  SpanStatusCode,
  type TracerProvider,
} from "@opentelemetry/api";
import preloadedContexts from "../contexts.ts";
import type { DocumentLoader, RemoteDocument } from "../docloader.ts";
import jsonld from "../jsonld.ts";
import type { PortableObjectVerifier } from "../portable.ts";
import {
  canonicalizePortableUri,
  formatIri,
  parseIri,
  toCompatibleEf61Id,
} from "../url.ts";

const logger = getLogger(["fedify", "vocab", "gateway"]);

/**
 * The maximum number of `@gateway` location hints to try for one reference.
 * Hints come from possibly untrusted documents, so they are bounded to keep
 * a single accessor call from fanning out to many servers.
 */
const MAX_GATEWAY_HINTS = 5;

const LOCATION_HINT_PARAMETER = "@gateway";

// The same baseline contexts that Fedify's proof verifier always resolves
// from its built-in copies (see getNormalizationContextLoader() in
// @fedify/fedify).  Serving them identically here keeps the identity check,
// the verifier, and the parser on the same context documents.  Other
// contexts go through the caller's context loader.
const BASELINE_CONTEXT_URLS: ReadonlySet<string> = new Set([
  "https://w3id.org/identity/v1",
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  "https://w3id.org/security/data-integrity/v1",
]);

/**
 * Checks whether a URL is an FEP-ef61 portable ActivityPub IRI.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export function isPortableIri(url: URL): boolean {
  return url.protocol === "ap+ef61:" || url.protocol === "ap:";
}

/**
 * Picks the ordered list of FEP-ef61 gateways to fetch a portable IRI from.
 *
 * If `gateways` is given, it is used as is (even when empty), and `@gateway`
 * location hints in the IRI are ignored.  Otherwise, up to
 * {@link MAX_GATEWAY_HINTS} valid `@gateway` hints are used.  Duplicate
 * gateways are dropped in both cases.
 *
 * @throws {TypeError} If an explicit gateway is not an HTTP(S) origin.
 * @internal
 */
export function getPortableGatewayCandidates(
  url: URL,
  gateways?: readonly (string | URL)[],
): URL[] {
  const candidates: URL[] = [];
  const seen = new Set<string>();
  const add = (gateway: URL) => {
    if (seen.has(gateway.href)) return;
    seen.add(gateway.href);
    candidates.push(gateway);
  };
  if (gateways != null) {
    for (const gateway of gateways) {
      const parsed = parseGatewayOrigin(gateway);
      if (parsed == null) {
        throw new TypeError(
          "FEP-ef61 gateways must be HTTP(S) origins with no credentials, " +
            "path, query, or fragment: " + String(gateway),
        );
      }
      add(parsed);
    }
    return candidates;
  }
  for (
    const hint of new URLSearchParams(url.search).getAll(
      LOCATION_HINT_PARAMETER,
    )
  ) {
    if (candidates.length >= MAX_GATEWAY_HINTS) break;
    const parsed = parseGatewayOrigin(hint);
    if (parsed == null) {
      logger.debug(
        "Ignoring an invalid FEP-ef61 gateway hint {hint} in {url}.",
        { hint, url: formatIri(url) },
      );
      continue;
    }
    add(parsed);
  }
  return candidates;
}

function parseGatewayOrigin(gateway: string | URL): URL | null {
  let url: URL;
  if (gateway instanceof URL) url = new URL(gateway.href);
  else if (typeof gateway === "string" && URL.canParse(gateway)) {
    url = new URL(gateway);
  } else return null;
  // Comparing href with the origin also rejects credentials, a path, and
  // query and fragment components, including empty ? and # delimiters.
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.href !== `${url.origin}/`
  ) {
    return null;
  }
  return url;
}

/**
 * Creates a context loader that returns the same context documents for the
 * whole dereference operation, so that the identity check, the proof
 * verifier, and the parser interpret the fetched document identically even
 * if the underlying loader is nondeterministic.  Failed loads are not
 * remembered, so a transient failure does not affect the next gateway.
 *
 * The parsed object keeps the loader for its own later dereferences, so
 * `release()` turns it into a plain pass-through to the underlying loader
 * once the operation is over.
 */
function createSnapshotContextLoader(
  contextLoader: DocumentLoader,
): { loader: DocumentLoader; release: () => void } {
  const cache = new Map<string, Promise<RemoteDocument>>();
  let released = false;
  const release = () => {
    released = true;
    cache.clear();
  };
  const loader: DocumentLoader = async (url, options) => {
    if (released) return await contextLoader(url, options);
    const key = URL.canParse(url) ? new URL(url).href : url;
    if (BASELINE_CONTEXT_URLS.has(key)) {
      return {
        contextUrl: null,
        document: structuredClone(preloadedContexts[key]),
        documentUrl: key,
      };
    }
    let promise = cache.get(key);
    if (promise == null) {
      const loading = contextLoader(url, options).then((document) =>
        structuredClone(document)
      );
      promise = loading;
      cache.set(key, loading);
      loading.catch(() => {
        if (cache.get(key) === loading) cache.delete(key);
      });
    }
    return structuredClone(await promise);
  };
  return { loader, release };
}

/**
 * Options for {@link dereferencePortableIri}.
 *
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export interface DereferencePortableIriOptions<T> {
  documentLoader: DocumentLoader;
  contextLoader: DocumentLoader;
  tracerProvider: TracerProvider;
  gateways?: readonly (string | URL)[];
  verifyPortableObject?: PortableObjectVerifier;
  suppressError?: boolean;
  crossOrigin?: "ignore" | "throw" | "trust";
  parse: (
    document: unknown,
    options: { contextLoader: DocumentLoader; baseUrl: URL },
  ) => Promise<T>;
  span: Span;
}

type Attempt =
  | { readonly type: "rejected"; readonly source: string }
  | { readonly type: "error"; readonly error: unknown };

class PortableObjectRejection {
  constructor(
    readonly message: string,
    readonly values: Record<string, unknown> = {},
  ) {}
}

/**
 * Dereferences an FEP-ef61 portable IRI through its gateways.
 *
 * Gateways are tried one by one until one of them returns a single-node
 * document whose `@id`, if any, canonically matches the requested IRI and
 * which passes `verifyPortableObject`.  When there is no gateway to try, the document
 * loader is asked for the portable IRI itself, and its result is validated
 * the same way.
 *
 * @returns The parsed object, or `null` if no valid object was retrieved and
 *          `suppressError` is set or the failure was a rejected object
 *          (unless `crossOrigin` is `"throw"`).
 * @throws {TypeError} If `gateways` has an invalid entry (always), if no
 *                     verifier is given, or if the IRI cannot be turned into
 *                     a gateway URL (unless `suppressError` is set).
 * @internal Technically exported for generated vocabulary classes, but not
 * part of the public API contract.  This is not considered public API for
 * Semantic Versioning decisions.
 */
export async function dereferencePortableIri<T extends { id: URL | null }>(
  url: URL,
  options: DereferencePortableIriOptions<T>,
): Promise<T | null> {
  url = parseIri(url);
  const lookupUrl = formatIri(url);
  const { span } = options;
  // Invalid gateways are a programming error, so they are never suppressed:
  const gateways = getPortableGatewayCandidates(url, options.gateways);
  const fail = (error: unknown): null => {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
    if (options.suppressError) {
      logger.error("Failed to dereference {url}: {error}", {
        url: lookupUrl,
        error,
      });
      return null;
    }
    throw error;
  };
  const verify = options.verifyPortableObject;
  if (verify == null) {
    return fail(
      new TypeError(
        "Dereferencing the portable object " + lookupUrl + " requires the " +
          "verifyPortableObject option, e.g., verifyPortableObjectProof() " +
          "from @fedify/fedify.",
      ),
    );
  }
  const requestUrls: { url: string; gateway: URL | null }[] = [];
  let expectedId: string;
  try {
    expectedId = canonicalizePortableUri(lookupUrl);
    for (const gateway of gateways) {
      requestUrls.push({ url: toCompatibleEf61Id(url, gateway).href, gateway });
    }
  } catch (error) {
    return fail(error);
  }
  if (requestUrls.length < 1) {
    // No gateway to ask; custom document loaders may still know how to
    // retrieve the portable IRI itself:
    requestUrls.push({ url: lookupUrl, gateway: null });
  }
  const snapshot = createSnapshotContextLoader(options.contextLoader);
  const contextLoader = snapshot.loader;
  const attempts: Attempt[] = [];
  try {
    for (const { url: requestUrl, gateway } of requestUrls) {
      let remoteDocument: RemoteDocument;
      try {
        remoteDocument = await options.documentLoader(requestUrl);
      } catch (error) {
        logger.debug("Failed to fetch {url} from {requestUrl}: {error}", {
          url: lookupUrl,
          requestUrl,
          error,
        });
        attempts.push({ type: "error", error });
        continue;
      }
      const { document } = remoteDocument;
      try {
        await checkPortableObjectId(document, expectedId, contextLoader);
        let result: { readonly verified: boolean };
        try {
          result = await verify(document, {
            documentLoader: options.documentLoader,
            contextLoader,
            tracerProvider: options.tracerProvider,
          });
        } catch (error) {
          throw new PortableObjectRejection(
            "the proof verifier failed: {error}",
            { error },
          );
        }
        if (!result.verified) {
          throw new PortableObjectRejection(
            "it does not satisfy the FEP-ef61 proof policy: {result}",
            { result },
          );
        }
        const object = await options.parse(document, {
          contextLoader,
          baseUrl: url,
        });
        if (gateway != null) {
          span.setAttribute("activitypub.gateway", gateway.href);
        }
        return object;
      } catch (error) {
        if (error instanceof PortableObjectRejection) {
          logger.warn(
            "Rejected the portable object {url} served from {requestUrl}, " +
              "because " + error.message,
            { ...error.values, url: lookupUrl, requestUrl },
          );
          attempts.push({ type: "rejected", source: requestUrl });
          continue;
        }
        logger.debug("Failed to parse {url} from {requestUrl}: {error}", {
          url: lookupUrl,
          requestUrl,
          error,
        });
        attempts.push({ type: "error", error });
      }
    }
  } finally {
    snapshot.release();
  }
  const rejected = attempts.filter((a) => a.type === "rejected");
  if (rejected.length > 0) {
    const message = "No gateway returned a valid portable object for " +
      lookupUrl + "; refusing to return the object.  Objects retrieved " +
      "from: " + rejected.map((a) => a.source).join(", ") + ".";
    if (options.suppressError || options.crossOrigin !== "throw") {
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      logger.warn(message);
      return null;
    }
    throw new Error(message);
  }
  const errors = attempts.flatMap((a) => a.type === "error" ? [a.error] : []);
  return fail(
    errors.length === 1 ? errors[0] : new AggregateError(
      errors,
      "Failed to dereference " + lookupUrl + " through any of its " +
        "gateways: " + requestUrls.map((r) => r.url).join(", "),
    ),
  );
}

async function checkPortableObjectId(
  document: unknown,
  expectedId: string,
  contextLoader: DocumentLoader,
): Promise<void> {
  if (
    document == null || typeof document !== "object" || Array.isArray(document)
  ) {
    throw new PortableObjectRejection("it is not a single JSON object");
  }
  const expanded = await jsonld.expand(document, {
    documentLoader: contextLoader,
    keepFreeFloatingNodes: true,
  });
  if (expanded.length !== 1) {
    throw new PortableObjectRejection(
      "it does not have exactly one top-level node",
    );
  }
  const id = expanded[0]["@id"];
  // A document without @id, such as a proof document, is left to the
  // verifier; verifyPortableObjectProof() rejects it, because there is no
  // portable ID to check its proof against:
  if (id == null) return;
  if (typeof id !== "string") {
    throw new PortableObjectRejection("it has an invalid @id");
  }
  // Compare the raw @id rather than a parsed URL, because URL parsing
  // normalizes opaque path segments (e.g., dot segments):
  let actualId: string | null;
  try {
    actualId = canonicalizePortableUri(id);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    actualId = null;
  }
  if (actualId !== expectedId) {
    throw new PortableObjectRejection(
      "its @id ({objectId}) does not match the requested portable ID",
      { objectId: id },
    );
  }
}
