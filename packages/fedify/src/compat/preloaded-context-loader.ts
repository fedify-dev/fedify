import { type DocumentLoader, preloadedContexts } from "@fedify/vocab-runtime";

/**
 * A restricted JSON-LD document loader that resolves only contexts bundled
 * with Fedify.
 *
 * This is intentionally narrower than `getDocumentLoader()`: normalization
 * helpers are also reached from verification paths that operate on inbound,
 * attacker-controlled JSON-LD, so the default fallback must never fetch
 * attacker-supplied context URLs.
 */
export const preloadedOnlyDocumentLoader: DocumentLoader = (url: string) => {
  if (Object.hasOwn(preloadedContexts, url)) {
    return Promise.resolve({
      contextUrl: null,
      documentUrl: url,
      document: preloadedContexts[url],
    });
  }
  return Promise.reject(
    new Error(
      "Refusing to fetch a non-preloaded JSON-LD context: " + url,
    ),
  );
};
