import {
  type DocumentLoader,
  FetchError,
  isTransientFetchError,
  parseIri,
} from "@fedify/vocab-runtime";
import type { InteractionRequestVerificationFailure } from "./types.ts";

export type UnverifiableFailure = Extract<
  InteractionRequestVerificationFailure,
  {
    readonly category: "unverifiable";
    readonly type: "notDereferenceable" | "invalidJsonLd";
  }
>;

export interface LoaderTracker {
  readonly documentLoader: DocumentLoader | undefined;
  readonly contextLoader: DocumentLoader | undefined;
  readonly records: ReadonlyMap<unknown, string>;
  readonly release: () => void;
}

/**
 * Wraps the loaders for a single dereferencing operation so that errors they
 * throw can be told apart from other errors afterwards.  Parsed objects keep
 * the loaders they were given, so the wrappers stop recording and pass calls
 * through once the operation is released.
 */
export function trackLoaders(
  documentLoader: DocumentLoader | undefined,
  contextLoader: DocumentLoader | undefined,
): LoaderTracker {
  const records = new Map<unknown, string>();
  let released = false;
  const wrap = (
    loader: DocumentLoader | undefined,
  ): DocumentLoader | undefined => {
    if (loader == null) return undefined;
    return async (url, options) => {
      if (released) return await loader(url, options);
      let remoteDocument;
      try {
        remoteDocument = await loader(url, options);
      } catch (error) {
        if (!released) records.set(error, url);
        throw error;
      }
      if (remoteDocument == null) {
        const message = "The document loader returned no document.";
        let error: Error;
        try {
          // FetchError's constructor cannot parse portable URLs by itself:
          error = new FetchError(parseIri(url), message);
        } catch {
          error = new Error(`${url}: ${message}`);
        }
        if (!released) records.set(error, url);
        throw error;
      }
      return remoteDocument;
    };
  };
  const wrappedDocumentLoader = wrap(documentLoader);
  return {
    documentLoader: wrappedDocumentLoader,
    contextLoader: contextLoader === documentLoader
      ? wrappedDocumentLoader
      : wrap(contextLoader),
    records,
    release: () => {
      released = true;
      records.clear();
    },
  };
}

const MAX_CAUSE_DEPTH = 8;

export function collectCauses(
  error: unknown,
  causes: unknown[] = [],
  depth = 0,
): unknown[] {
  if (depth > MAX_CAUSE_DEPTH || causes.includes(error)) return causes;
  causes.push(error);
  if (typeof error !== "object" || error == null) return causes;
  if (error instanceof AggregateError) {
    for (const e of error.errors) collectCauses(e, causes, depth + 1);
  }
  // Loaders may throw anything, even null, so check for the properties
  // rather than their values:
  if ("cause" in error) collectCauses(error.cause, causes, depth + 1);
  // jsonld.js reports a failed remote context load as `details.cause`:
  const details = (error as { readonly details?: unknown }).details;
  if (typeof details === "object" && details != null && "cause" in details) {
    collectCauses(details.cause, causes, depth + 1);
  }
  return causes;
}

/**
 * Classifies the error thrown by a dereferencing operation.  It is a fetch
 * failure only if a loader error is among its causes; errors that loaders
 * threw during attempts the operation recovered from are ignored.
 */
export function classifyFailure(
  error: unknown,
  tracker: LoaderTracker,
): UnverifiableFailure {
  const loaderErrors = collectCauses(error).filter((e) =>
    tracker.records.has(e)
  );
  // Loaders may throw anything, even null, so look up indices, not values:
  const transientIndex = loaderErrors.findIndex(isTransientFetchError);
  const selected = loaderErrors[transientIndex < 0 ? 0 : transientIndex];
  const url = loaderErrors.length < 1
    ? null
    : getFailedUrl(selected, tracker.records.get(selected)!);
  // A document referring to a URL that cannot even be parsed is malformed:
  if (url == null) {
    return {
      category: "unverifiable",
      type: "invalidJsonLd",
      cause: error,
      transient: false,
    };
  }
  return {
    category: "unverifiable",
    type: "notDereferenceable",
    url,
    cause: loaderErrors.length === 1 ? selected : error,
    transient: transientIndex >= 0,
  };
}

function getFailedUrl(error: unknown, requestedUrl: string): URL | null {
  const url = (error as { readonly url?: unknown } | null)?.url;
  if (url instanceof URL) return url;
  for (const candidate of [url, requestedUrl]) {
    if (typeof candidate !== "string") continue;
    try {
      return parseIri(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

export function notDereferenceable(url: URL): UnverifiableFailure {
  return {
    category: "unverifiable",
    type: "notDereferenceable",
    url,
    transient: false,
  };
}
