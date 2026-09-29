import {
  lookupObject,
  type LookupObjectOptions,
  type Object as APObject,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  FetchError,
  UrlError,
} from "@fedify/vocab-runtime";

/** A loader failure retained by the CLI, including where it occurred. */
export interface LookupFailure {
  error: unknown;
  source: "object" | "context" | "other";
}

/** Records loader failures that lookupObject would otherwise swallow or wrap. */
export function createLookupDiagnostics(
  documentLoader: DocumentLoader,
  contextLoader: DocumentLoader,
) {
  let objectFailure: LookupFailure | undefined;
  let contextFailure: LookupFailure | undefined;
  const wrap = (
    loader: DocumentLoader,
    source: "object" | "context",
    record: (failure: LookupFailure | undefined) => void,
  ): DocumentLoader =>
  async (url, options) => {
    try {
      const document = await loader(url, options);
      record(undefined);
      return document;
    } catch (error) {
      record({ error, source });
      throw error;
    }
  };
  return {
    documentLoader: wrap(documentLoader, "object", (e) => objectFailure = e),
    contextLoader: wrap(contextLoader, "context", (e) => contextFailure = e),
    clearFailures() {
      objectFailure = undefined;
      contextFailure = undefined;
    },
    getObjectFailure: () => objectFailure,
    getContextFailure: () => contextFailure,
  };
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
  },
): Promise<LookupResult> {
  const diagnostics = createLookupDiagnostics(
    options.documentLoader,
    options.contextLoader,
  );
  try {
    const object = await lookupObject(identifier, {
      ...options,
      ...diagnostics,
    });
    return Object.freeze({
      object,
      failure: object == null
        ? diagnostics.getObjectFailure() ?? diagnostics.getContextFailure()
        : undefined,
    });
  } catch (error) {
    return Object.freeze({
      object: null,
      thrownError: error,
      failure: diagnostics.getContextFailure() ??
        diagnostics.getObjectFailure() ?? {
        error,
        source: "other" as const,
      },
    });
  }
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
