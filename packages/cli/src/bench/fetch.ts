/**
 * The fetch signature that benchmark code depends on.
 * @module
 */

/**
 * The standard `fetch()` call signature.
 *
 * Benchmark code accepts this instead of `typeof fetch` because a runtime's
 * declared `fetch` type can carry non-standard members (Bun's declares
 * `preconnect()`, for example) that wrappers and test doubles do not
 * implement.  The global `fetch` is still assignable to this type.
 */
export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
