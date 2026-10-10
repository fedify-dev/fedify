import {
  generateCryptoKeyPair,
  getAuthenticatedDocumentLoader,
  respondWithObject,
} from "@fedify/fedify";
import {
  Application,
  Collection,
  CryptographicKey,
  type Link,
  lookupObject,
  Object as APObject,
  traverseCollection,
} from "@fedify/vocab";
import {
  type DocumentLoader,
  expandIPv6Address,
  FetchError,
  formatIri,
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  UrlError,
} from "@fedify/vocab-runtime";
import type { ResourceDescriptor } from "@fedify/webfinger";
import { getLogger } from "@logtape/logtape";
import { type InferValue, message, optionNames, text } from "@optique/core";
import { url as messageUrl } from "@optique/core/message";
import { printError } from "@optique/run";
import { createWriteStream, type WriteStream } from "node:fs";
import { isIP } from "node:net";
import process from "node:process";
import ora from "ora";
import { getContextLoader, getDocumentLoader } from "./docloader.ts";
import {
  createLookupDiagnostics,
  describeLookupFailure,
  type LookupFailure,
  lookupWithDiagnostics,
} from "./diagnostics.ts";
import { renderImages } from "./imagerenderer.ts";
import {
  FEDIBIRD_QUOTE_IRI,
  IN_REPLY_TO_IRI,
  type lookupOptions,
  MISSKEY_QUOTE_IRI,
  QUOTE_IRI,
  QUOTE_URL_IRI,
  type RecurseProperty,
} from "./lookup/command.ts";
import { configureLogging } from "./log.ts";
import type { GlobalOptions } from "./options.ts";
import { getIriKey, getPortableLookupProblem } from "./portable.ts";
import { spawnTemporaryServer, type TemporaryServer } from "./tempserver.ts";
import { colorEnabled, colors, describeError, formatObject } from "./utils.ts";

export {
  authorizedFetchOption,
  lookupCommand,
  lookupMetadata,
  lookupOptions,
} from "./lookup/command.ts";

const logger = getLogger(["fedify", "cli", "lookup"]);

export class TimeoutError extends Error {
  override name = "TimeoutError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TimeoutError";
  }
}

/**
 * The timeout that the built-in document loaders use when `-T`/`--timeout`
 * is not given, in seconds.
 */
const DEFAULT_TIMEOUT_SECONDS = 10;

/**
 * The maximum delay in milliseconds that timers accept.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Error thrown when a recursive lookup target cannot be fetched.
 */
export class RecursiveLookupError extends Error {
  target: string;
  /** Why the target could not be fetched, if known. */
  failure?: LookupFailure;
  constructor(target: string, failure?: LookupFailure, options?: ErrorOptions) {
    super(`Failed to recursively fetch object: ${target}`, options);
    this.name = "RecursiveLookupError";
    this.target = target;
    this.failure = failure;
  }
}

type LookupCommand = InferValue<typeof lookupOptions> & GlobalOptions;

function writeToStream(
  stream: NodeJS.WritableStream,
  chunk: string | Uint8Array,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      stream.off("error", onError);
      reject(error);
    };
    stream.once("error", onError);
    try {
      stream.write(chunk, (error) => {
        stream.off("error", onError);
        if (error != null) reject(error);
        else resolve();
      });
    } catch (error) {
      stream.off("error", onError);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function endWritableStream(stream: WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      stream.off("error", onError);
      reject(error);
    };
    stream.once("error", onError);
    try {
      stream.end((error?: Error | null) => {
        stream.off("error", onError);
        if (error != null) reject(error);
        else resolve();
      });
    } catch (error) {
      stream.off("error", onError);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function findAllImages(obj: APObject): Promise<URL[]> {
  const result: URL[] = [];
  const icon = await obj.getIcon();
  const image = await obj.getImage();

  if (icon && icon.url instanceof URL) {
    result.push(icon.url);
  }
  if (image && image.url instanceof URL) {
    result.push(image.url);
  }

  return result;
}

export async function writeObjectToStream(
  object: APObject | Link,
  outputPath: string | undefined,
  format: string | undefined,
  contextLoader: DocumentLoader,
  stream?: NodeJS.WritableStream,
): Promise<void> {
  const localStream: WriteStream | NodeJS.WritableStream = stream ??
    (outputPath ? createWriteStream(outputPath) : process.stdout);
  const localFileStream = stream == null && outputPath != null
    ? localStream as WriteStream
    : undefined;

  let content;
  let json = true;
  let imageUrls: URL[] = [];

  if (format) {
    if (format === "raw") {
      content = await object.toJsonLd({ contextLoader });
    } else if (format === "compact") {
      content = await object.toJsonLd({ format: "compact", contextLoader });
    } else if (format === "expand") {
      content = await object.toJsonLd({ format: "expand", contextLoader });
    } else {
      content = object;
      json = false;
    }
  } else {
    content = object;
    json = false;
  }

  const enableColors = colorEnabled && localStream === process.stdout;
  content = formatObject(content, enableColors, json);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(content + "\n");

  await writeToStream(localStream, bytes);

  if (localFileStream != null) {
    await endWritableStream(localFileStream);
  }

  if (object instanceof APObject) {
    imageUrls = await findAllImages(object);
  }
  if (localStream === process.stdout && imageUrls.length > 0) {
    await renderImages(imageUrls);
  }
}

async function closeWriteStream(stream?: WriteStream): Promise<void> {
  if (stream == null) return;
  await endWritableStream(stream);
}

export async function writeSeparator(
  separator: string,
  stream?: NodeJS.WritableStream,
): Promise<void> {
  await writeToStream(stream ?? process.stdout, `${separator}\n`);
}

export function toPresentationOrder<T>(
  items: readonly T[],
  reverse: boolean,
): readonly T[] {
  if (reverse) return [...items].reverse();
  return items;
}

export async function collectAsyncItems<T>(
  iterable: AsyncIterable<T>,
): Promise<{ items: T[]; error?: unknown }> {
  const items: T[] = [];
  try {
    for await (const item of iterable) {
      items.push(item);
    }
    return { items };
  } catch (error) {
    return { items, error };
  }
}

/**
 * Converts the `-T`/`--timeout` option in seconds into the `timeout` option
 * of the built-in document loaders in milliseconds.  Zero means timing out
 * immediately, and too long timeouts are clamped to what timers accept.
 * @param timeoutSeconds The timeout in seconds, if given.
 * @returns The timeout in milliseconds, or `undefined` for the default.
 */
export function toDocumentLoaderTimeout(
  timeoutSeconds?: number,
): number | undefined {
  if (timeoutSeconds == null) return undefined;
  return Math.min(
    MAX_TIMEOUT_MS,
    Math.max(1, Math.ceil(timeoutSeconds * 1000)),
  );
}

/**
 * Checks whether the given error was thrown by a built-in document loader
 * that timed out.
 * @param error The error to check.
 * @returns `true` if the document loader timed out.
 */
export function isDocumentLoaderTimeoutError(error: unknown): boolean {
  return error instanceof FetchError && error.response == null &&
    error.cause instanceof Error && error.cause.name === "TimeoutError";
}

/**
 * Wraps a built-in document loader so that its timeouts are thrown as
 * {@link TimeoutError}s, which the lookup command reports specially.
 */
export function wrapDocumentLoaderWithTimeout(
  loader: DocumentLoader,
  timeoutSeconds?: number,
): DocumentLoader {
  return (url, options) =>
    loader(url, options).catch((error) => {
      if (isDocumentLoaderTimeoutError(error)) {
        throw new TimeoutError(
          `Request timed out after ${
            timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
          } seconds`,
          { cause: error },
        );
      }
      throw error;
    });
}

function handleTimeoutError(
  spinner: { fail: (text: string) => void },
  timeoutSeconds?: number,
  url?: string,
): void {
  const urlText = url ? ` for: ${colors.red(url)}` : "";
  spinner.fail(
    `Request timed out after ${
      timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    } seconds${urlText}.`,
  );
  printError(
    message`Try increasing the timeout with ${
      optionNames(["-T", "--timeout"])
    } option or check network connectivity.`,
  );
}

function isPrivateAddressError(error: unknown): boolean {
  const errorMessage = describeError(error);
  const lowerMessage = errorMessage.toLowerCase();
  if (error instanceof UrlError) {
    return error.reason === "disallowed" && (
      lowerMessage.includes("invalid or private address") ||
      lowerMessage.includes("localhost is not allowed")
    );
  }
  return (
    lowerMessage.includes("private address") ||
    lowerMessage.includes("private ip") ||
    lowerMessage.includes("localhost") ||
    lowerMessage.includes("loopback")
  );
}

export function getPrivateUrlCandidate(
  candidate: unknown,
): URL | null {
  // This helper is only for post-failure hinting. It intentionally does a
  // cheap hostname/IP check so we can recognize obvious private targets
  // without re-running the full document-loader validation path.
  if (typeof candidate !== "string" && !(candidate instanceof URL)) return null;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname;
    if (hostname === "localhost") return url;

    const normalized = hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
    const ipVersion = isIP(normalized);
    if (ipVersion === 4) {
      return isValidPublicIPv4Address(normalized) ? null : url;
    }
    if (ipVersion === 6) {
      const expanded = expandIPv6Address(normalized);
      return isValidPublicIPv6Address(expanded) ? null : url;
    }
    return null;
  } catch {
    return null;
  }
}

function isPrivateAddressTarget(target: string): boolean {
  return getPrivateUrlCandidate(target) != null;
}

function getPrivateContextUrl(error: unknown): URL | null {
  // Recursive object fetches and recursive JSON-LD context fetches use
  // different loader policies. When the strict context loader rejects a
  // private @context URL, the underlying UrlError is often surfaced as a
  // jsonld parsing error instead of the original loader error. This helper
  // reconstructs the blocked private context URL so the CLI can show a
  // recurse-specific hint instead of the generic authorized-fetch hint.
  // This detection intentionally depends on jsonld's current error shape:
  // name === "jsonld.InvalidUrl", the "valid JSON-LD object" substring, and
  // a trailing `URL: "..."` segment all at once. If jsonld changes those
  // details, this helper and the related lookup tests need to be updated
  // together.
  const errorMessage = describeError(error);
  if (
    !(error instanceof Error) ||
    error.name !== "jsonld.InvalidUrl" ||
    !errorMessage.includes("valid JSON-LD object")
  ) {
    return null;
  }

  const structuredError = error as {
    details?: { url?: unknown };
    url?: unknown;
  };
  const structuredUrl = getPrivateUrlCandidate(structuredError.details?.url) ??
    getPrivateUrlCandidate(structuredError.url);
  if (structuredUrl != null) return structuredUrl;

  const match = errorMessage.match(/URL:\s*"([^"]+)"/);
  if (match == null) return null;
  return getPrivateUrlCandidate(match[1]);
}

function printRecursivePrivateAddressHint(): void {
  printError(
    message`The recursive target appears to be private or localhost.  Try with ${
      optionNames(["-p", "--allow-private-address"])
    }, or use ${
      optionNames(["-S", "--suppress-errors"])
    } to skip blocked steps.`,
  );
}

function printRecursivePrivateContextHint(privateContextUrl: URL): void {
  printError(
    message`Recursive JSON-LD context URL ${
      messageUrl(privateContextUrl)
    } is always blocked, even with ${
      optionNames(["-p", "--allow-private-address"])
    }.  Use ${optionNames(["-S", "--suppress-errors"])} to skip blocked steps.`,
  );
}

export function getLookupFailureHint(
  error: unknown,
  options: { recursive?: boolean } = {},
):
  | "dns"
  | "private-address"
  | "recursive-private-address"
  | "authorized-fetch" {
  if (error instanceof UrlError && error.reason === "dns") return "dns";
  if (isPrivateAddressError(error)) {
    return options.recursive ? "recursive-private-address" : "private-address";
  }
  return "authorized-fetch";
}

export function shouldPrintLookupFailureHint(
  authLoader: DocumentLoader | undefined,
  hint: ReturnType<typeof getLookupFailureHint>,
): boolean {
  return hint !== "authorized-fetch" || authLoader == null;
}

export function shouldSuggestSuppressErrorsForLookupFailure(
  authLoader: DocumentLoader | undefined,
  hint: ReturnType<typeof getLookupFailureHint>,
): boolean {
  return authLoader != null && hint === "authorized-fetch";
}

function printLookupFailureHint(
  authLoader: DocumentLoader | undefined,
  error: unknown,
  options: { recursive?: boolean } = {},
): void {
  const hint = getLookupFailureHint(error, options);
  if (!shouldPrintLookupFailureHint(authLoader, hint)) return;
  switch (hint) {
    case "dns":
      printError(
        message`DNS lookup failed.  Check the hostname and network connectivity.`,
      );
      return;
    case "private-address":
      printError(
        message`The URL appears to be private or localhost.  Try with ${
          optionNames(["-p", "--allow-private-address"])
        }.`,
      );
      return;
    case "recursive-private-address":
      printRecursivePrivateAddressHint();
      return;
    case "authorized-fetch":
      printError(
        message`It may be a private object.  Try with ${
          optionNames(["-a", "--authorized-fetch"])
        }.`,
      );
      return;
  }
}

/** A follow-up lookup failure, classified without changing loader policy. */
export interface RecursiveLookupFailure {
  /** The recursive object target, when the lookup retained it. */
  readonly target?: string;
  /**
   * `not-found` means no object and no recorded evidence, not an HTTP 404.
   * Context failures retain their source even when classified as timeouts
   * or private-address rejections.
   */
  readonly kind:
    | "timeout"
    | "private-address"
    | "not-found"
    | "context"
    | "fetch-or-parse";
  readonly source?: LookupFailure["source"];
  /**
   * Whether suppression can return the already collected prefix. This model
   * covers follow-up fetches only, never initial lookups or output writes.
   */
  readonly suppressible: boolean;
  /** Preserve generic headlines for errors that previously escaped directly. */
  readonly presentation: "target" | "generic";
  /** The error to log, preserving the original generic error when available. */
  readonly error: unknown;
  readonly hint:
    | { readonly type: "private-address" }
    | { readonly type: "private-context"; readonly url: URL }
    | { readonly type: "dns" }
    | { readonly type: "authorized-fetch" }
    | { readonly type: "suppress-errors" }
    | { readonly type: "diagnostic"; readonly message: string }
    | { readonly type: "none" };
}

function isSuppressibleRecursiveFailure(
  kind: RecursiveLookupFailure["kind"],
): boolean {
  switch (kind) {
    case "timeout":
    case "private-address":
    case "not-found":
    case "context":
    case "fetch-or-parse":
      return true;
  }
}

/**
 * Classifies recursive follow-up failures and selects their existing hints.
 * @param error The error from collecting a recursive chain.
 * @param options The policies that affect hints, rather than loader behavior.
 * @returns A failure that can be rendered without inspecting its error again.
 */
export function classifyRecursiveLookupFailure(
  error: unknown,
  options: { allowPrivateAddress: boolean; authorizedFetch: boolean },
): RecursiveLookupFailure {
  const wrapped = error instanceof RecursiveLookupError ? error : undefined;
  const failure = wrapped?.failure;
  const recordedTimeout = failure?.error instanceof TimeoutError;
  const presentation = wrapped != null &&
      (wrapped.cause == null || recordedTimeout)
    ? "target"
    : "generic";
  const underlyingError = presentation === "target"
    ? failure?.error
    : wrapped?.cause ?? error;
  const timeout = underlyingError instanceof TimeoutError || recordedTimeout;
  const privateContextUrl = presentation === "generic" ||
      failure?.source === "context"
    ? getPrivateContextUrl(underlyingError)
    : null;
  const blockedTarget = presentation === "target" &&
    !options.allowPrivateAddress && wrapped != null &&
    isPrivateAddressTarget(wrapped.target);

  let hint: RecursiveLookupFailure["hint"] = { type: "none" };
  if (!timeout) {
    if (presentation === "target") {
      if (blockedTarget) hint = { type: "private-address" };
      else if (privateContextUrl != null) {
        hint = { type: "private-context", url: privateContextUrl };
      } else if (failure != null) {
        hint = {
          type: "diagnostic",
          message: describeLookupFailure(failure, options.authorizedFetch)
            .message,
        };
      } else if (!options.authorizedFetch) {
        hint = { type: "authorized-fetch" };
      }
    } else if (privateContextUrl != null) {
      hint = { type: "private-context", url: privateContextUrl };
    } else {
      const legacyHint = getLookupFailureHint(underlyingError, {
        recursive: true,
      });
      hint = legacyHint === "authorized-fetch"
        ? { type: options.authorizedFetch ? "suppress-errors" : legacyHint }
        : { type: legacyHint === "dns" ? "dns" : "private-address" };
    }
  }

  const kind: RecursiveLookupFailure["kind"] = timeout
    ? "timeout"
    : privateContextUrl != null
    ? "context"
    // FetchError messages include their URL; "localhost" in that URL is
    // not evidence that the loader blocked the address.
    : blockedTarget ||
        !(underlyingError instanceof FetchError) &&
          isPrivateAddressError(underlyingError)
    ? "private-address"
    : failure?.source === "context"
    ? "context"
    : presentation === "target" && failure == null
    ? "not-found"
    : "fetch-or-parse";
  return {
    target: wrapped?.target,
    kind,
    source: failure?.source,
    suppressible: isSuppressibleRecursiveFailure(kind),
    presentation,
    error: presentation === "generic" ? underlyingError : error,
    hint,
  };
}

/**
 * Renders a classified recursive failure without reinterpreting its error.
 * @param failure The classified follow-up failure.
 * @param spinner The spinner that displays the failure headline.
 * @param timeoutSeconds The requested timeout, in seconds.
 * @internal
 */
export function printRecursiveLookupFailure(
  failure: RecursiveLookupFailure,
  spinner: { fail: (text: string) => void },
  timeoutSeconds?: number,
): void {
  const target = failure.presentation === "target" ? failure.target : undefined;
  if (failure.kind === "timeout") {
    handleTimeoutError(spinner, timeoutSeconds, target);
    return;
  }
  spinner.fail(
    target == null
      ? "Failed to recursively fetch object."
      : `Failed to recursively fetch object: ${colors.red(target)}.`,
  );
  switch (failure.hint.type) {
    case "private-address":
      printRecursivePrivateAddressHint();
      return;
    case "private-context":
      printRecursivePrivateContextHint(failure.hint.url);
      return;
    case "dns":
      printError(
        message`DNS lookup failed.  Check the hostname and network connectivity.`,
      );
      return;
    case "authorized-fetch":
      printError(
        message`It may be a private object.  Try with ${
          optionNames(["-a", "--authorized-fetch"])
        }.`,
      );
      return;
    case "suppress-errors":
      printError(
        message`Use the ${
          optionNames(["-S", "--suppress-errors"])
        } option to suppress partial errors.`,
      );
      return;
    case "diagnostic":
      printError(message`${text(failure.hint.message)}`);
      return;
    case "none":
      return;
  }
}

/**
 * Gets the next recursion target URL from an ActivityPub object.
 */
export function getRecursiveTargetId(
  object: APObject,
  recurseProperty: RecurseProperty,
): URL | null {
  switch (recurseProperty) {
    case "replyTarget":
    case IN_REPLY_TO_IRI:
      return object.replyTargetId;
    case "quote":
    case QUOTE_IRI: {
      const quote = (object as { quoteId?: unknown }).quoteId;
      return quote instanceof URL ? quote : null;
    }
    case "quoteUrl":
    case QUOTE_URL_IRI:
    case MISSKEY_QUOTE_IRI:
    case FEDIBIRD_QUOTE_IRI: {
      const quoteUrl = (object as { quoteUrl?: unknown }).quoteUrl;
      return quoteUrl instanceof URL ? quoteUrl : null;
    }
    default:
      return null;
  }
}

/**
 * Collects recursively linked objects up to a depth limit.
 */
export async function collectRecursiveObjects(
  initialObject: APObject,
  recurseProperty: RecurseProperty,
  recurseDepth: number,
  lookup: (url: string) => Promise<APObject | null>,
  options: { suppressErrors: boolean; visited?: Set<string> },
): Promise<APObject[]> {
  const visited = options.visited ?? new Set<string>();
  const results: APObject[] = [];
  let current = initialObject;
  if (current.id != null) {
    visited.add(getVisitedKey(current.id));
  }

  for (let depth = 0; depth < recurseDepth; depth++) {
    const targetId = getRecursiveTargetId(current, recurseProperty);
    if (targetId == null) break;
    const target = formatTarget(targetId);
    if (visited.has(getVisitedKey(targetId))) break;

    let next: APObject | null;
    try {
      next = await lookup(target);
    } catch (error) {
      if (options.suppressErrors) {
        logger.debug(
          "Failed to recursively fetch object {target}, " +
            "but suppressing error: {error}",
          { target, error },
        );
        break;
      }
      throw error;
    }
    if (next == null) {
      if (options.suppressErrors) {
        logger.debug(
          "Failed to recursively fetch object {target} " +
            "(not found), but suppressing error.",
          { target },
        );
        break;
      }
      throw new RecursiveLookupError(target);
    }
    results.push(next);
    visited.add(getVisitedKey(targetId));
    if (next.id != null) {
      visited.add(getVisitedKey(next.id));
    }
    current = next;
  }

  return results;
}

/**
 * Gets the key for recognizing an already visited object, which identifies
 * FEP-ef61 portable objects by their canonical IDs.
 * @param iri The object's ID, or the raw string given by the user.
 * @returns The key.
 */
export function getVisitedKey(iri: string | URL): string {
  return getIriKey(iri) ?? (typeof iri === "string" ? iri : iri.href);
}

/**
 * Formats a recursion target, printing FEP-ef61 portable IDs in their
 * canonical form rather than their percent-encoded `URL` form.
 */
function formatTarget(target: URL): string {
  try {
    return formatIri(target);
  } catch {
    return target.href;
  }
}

export async function runLookup(
  command: LookupCommand,
  deps: Partial<{
    lookupObject: typeof lookupObject;
    traverseCollection: typeof traverseCollection;
    getDocumentLoader: typeof getDocumentLoader;
    exit: (code: number) => never;
  }> = {},
) {
  const effectiveDeps: {
    lookupObject: typeof lookupObject;
    traverseCollection: typeof traverseCollection;
    getDocumentLoader: typeof getDocumentLoader;
    exit: (code: number) => never;
  } = {
    lookupObject,
    traverseCollection,
    getDocumentLoader,
    exit: (code: number) => process.exit(code),
    ...deps,
  };

  const lookupDiagnosed = (
    identifier: string | URL,
    options: Parameters<typeof lookupWithDiagnostics>[1],
  ) => lookupWithDiagnostics(identifier, options, effectiveDeps.lookupObject);

  // The gateways given with --gateway, used for the objects given on
  // the command line (and for linked objects without location hints):
  const gatewayOptions = command.gateways.length > 0
    ? { gateways: command.gateways }
    : {};

  if (command.urls.length < 1) {
    printError(message`At least one URL or actor handle must be provided.`);
    effectiveDeps.exit(1);
  }

  // Enable Debug mode if requested
  if (command.debug) {
    await configureLogging();
  }

  const spinner = ora({
    text: `Looking up the ${
      command.recurse != null
        ? "object chain"
        : command.traverse
        ? "collection"
        : command.urls.length > 1
        ? "objects"
        : "object"
    }...`,
    discardStdin: false,
  }).start();

  let server: TemporaryServer | undefined = undefined;
  // URLs explicitly provided by the user always allow private addresses,
  // so that local servers can be looked up without -p/--allow-private-address.
  // URLs discovered during traversal or recursion follow the option to
  // mitigate SSRF against private addresses.
  const initialBaseDocumentLoader = await effectiveDeps.getDocumentLoader({
    userAgent: command.userAgent,
    allowPrivateAddress: true,
    timeout: toDocumentLoaderTimeout(command.timeout),
  });
  const initialDocumentLoader = wrapDocumentLoaderWithTimeout(
    initialBaseDocumentLoader,
    command.timeout,
  );
  const baseDocumentLoader = await effectiveDeps.getDocumentLoader({
    userAgent: command.userAgent,
    allowPrivateAddress: command.allowPrivateAddress,
    timeout: toDocumentLoaderTimeout(command.timeout),
  });
  const documentLoader = wrapDocumentLoaderWithTimeout(
    baseDocumentLoader,
    command.timeout,
  );
  const baseContextLoader = await getContextLoader({
    userAgent: command.userAgent,
    allowPrivateAddress: command.allowPrivateAddress,
    timeout: toDocumentLoaderTimeout(command.timeout),
  });
  const contextLoader = wrapDocumentLoaderWithTimeout(
    baseContextLoader,
    command.timeout,
  );

  let authLoader: DocumentLoader | undefined = undefined;
  let initialAuthLoader: DocumentLoader | undefined = undefined;
  let authIdentity:
    | { keyId: URL; privateKey: CryptoKey }
    | undefined = undefined;
  let outputStream: WriteStream | undefined;
  let outputStreamError: Error | undefined;
  const getOutputStream = (): WriteStream | undefined => {
    if (command.output == null) return undefined;
    if (outputStream == null) {
      outputStream = createWriteStream(command.output);
      outputStream.once("error", (error) => {
        outputStreamError = error;
      });
    }
    if (outputStreamError != null) {
      throw outputStreamError;
    }
    return outputStream;
  };
  const finalizeAndExit = async (code: number) => {
    let cleanupFailed = false;
    try {
      await closeWriteStream(outputStream);
    } catch (error) {
      cleanupFailed = true;
      logger.error("Failed to close output stream during shutdown: {error}", {
        error,
      });
    }
    try {
      await server?.close();
    } catch (error) {
      cleanupFailed = true;
      logger.error(
        "Failed to close temporary server during shutdown: {error}",
        {
          error,
        },
      );
    }
    effectiveDeps.exit(cleanupFailed && code === 0 ? 1 : code);
  };

  if (command.authorizedFetch) {
    const firstKnock = command.firstKnock ??
      "draft-cavage-http-signatures-12";
    spinner.text = "Generating a one-time key pair...";
    const key = await generateCryptoKeyPair();
    spinner.text = "Spinning up a temporary ActivityPub server...";
    server = await spawnTemporaryServer((req) => {
      const serverUrl = server?.url ?? new URL("http://localhost/");
      if (new URL(req.url).pathname == "/.well-known/webfinger") {
        const jrd: ResourceDescriptor = {
          subject: `acct:${serverUrl.hostname}@${serverUrl.hostname}`,
          aliases: [serverUrl.href],
          links: [
            {
              rel: "self",
              href: serverUrl.href,
              type: "application/activity+json",
            },
          ],
        };
        return new Response(JSON.stringify(jrd), {
          headers: { "Content-Type": "application/jrd+json" },
        });
      }
      return respondWithObject(
        new Application({
          id: serverUrl,
          preferredUsername: serverUrl?.hostname,
          publicKey: new CryptographicKey({
            id: new URL("#main-key", serverUrl),
            owner: serverUrl,
            publicKey: key.publicKey,
          }),
          manuallyApprovesFollowers: true,
          inbox: new URL("/inbox", serverUrl),
          outbox: new URL("/outbox", serverUrl),
        }),
        { contextLoader },
      );
    }, { service: command.tunnelService });
    authIdentity = {
      keyId: new URL("#main-key", server.url),
      privateKey: key.privateKey,
    };
    const baseAuthLoader = getAuthenticatedDocumentLoader(
      authIdentity,
      {
        allowPrivateAddress: command.allowPrivateAddress,
        userAgent: command.userAgent,
        timeout: toDocumentLoaderTimeout(command.timeout),
        specDeterminer: {
          determineSpec() {
            return firstKnock;
          },
          rememberSpec() {
          },
        },
      },
    );
    authLoader = wrapDocumentLoaderWithTimeout(
      baseAuthLoader,
      command.timeout,
    );
    const initialBaseAuthLoader = getAuthenticatedDocumentLoader(
      authIdentity,
      {
        allowPrivateAddress: true,
        userAgent: command.userAgent,
        timeout: toDocumentLoaderTimeout(command.timeout),
        specDeterminer: {
          determineSpec() {
            return firstKnock;
          },
          rememberSpec() {
          },
        },
      },
    );
    initialAuthLoader = wrapDocumentLoaderWithTimeout(
      initialBaseAuthLoader,
      command.timeout,
    );
  }

  spinner.text = `Looking up the ${
    command.recurse != null
      ? "object chain"
      : command.traverse
      ? "collection"
      : command.urls.length > 1
      ? "objects"
      : "object"
  }...`;

  if (command.recurse != null) {
    const initialLookupDocumentLoader: DocumentLoader = initialAuthLoader ??
      initialDocumentLoader;
    const recursiveLookupDocumentLoader: DocumentLoader = authLoader ??
      documentLoader;
    // `-p/--allow-private-address` only changes the follow-up object fetches
    // that recurse explicitly performs. JSON-LD context loads stay on the
    // strict loader so a remote object cannot implicitly expand the trust
    // boundary via private @context URLs.
    const recursiveBaseContextLoader = await getContextLoader({
      userAgent: command.userAgent,
      allowPrivateAddress: false,
      timeout: toDocumentLoaderTimeout(command.timeout),
    });
    const recursiveContextLoader = wrapDocumentLoaderWithTimeout(
      recursiveBaseContextLoader,
      command.timeout,
    );
    let totalObjects = 0;
    const recurseDepth = command.recurseDepth!;

    for (let urlIndex = 0; urlIndex < command.urls.length; urlIndex++) {
      const visited = new Set<string>();
      const url = command.urls[urlIndex];
      if (urlIndex > 0) {
        spinner.text = `Looking up object chain ${
          urlIndex + 1
        }/${command.urls.length}...`;
      }
      const result = await lookupDiagnosed(url, {
        documentLoader: initialLookupDocumentLoader,
        contextLoader,
        verifierDocumentLoader: recursiveLookupDocumentLoader,
        userAgent: command.userAgent,
        ...gatewayOptions,
      });
      const current = result.object;
      if (current == null) {
        if (
          result.thrownError instanceof TimeoutError ||
          result.failure?.error instanceof TimeoutError
        ) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
          const diagnostic = describeLookupFailure(
            result.failure,
            authLoader != null,
          );
          printError(message`${text(diagnostic.message)}`);
        }
        await finalizeAndExit(1);
        return;
      }

      visited.add(getVisitedKey(url));
      if (current.id != null) {
        visited.add(getVisitedKey(current.id));
      }

      if (!command.reverse) {
        try {
          if (totalObjects > 0) {
            await writeSeparator(command.separator, getOutputStream());
          }
          await writeObjectToStream(
            current,
            command.output,
            command.format,
            contextLoader,
            getOutputStream(),
          );
          totalObjects++;
        } catch (error) {
          logger.error("Failed to write lookup output: {error}", { error });
          spinner.fail("Failed to write output.");
          await finalizeAndExit(1);
          return;
        }
      }

      let chain: APObject[] = [];
      try {
        chain = await collectRecursiveObjects(
          current,
          command.recurse,
          recurseDepth,
          async (target) => {
            const result = await lookupDiagnosed(target, {
              documentLoader: recursiveLookupDocumentLoader,
              contextLoader: recursiveContextLoader,
              verifierDocumentLoader: recursiveLookupDocumentLoader,
              userAgent: command.userAgent,
              // --gateway is used for linked objects only if they have no
              // location hints of their own:
              ...(getPortableLookupProblem(target) === "no-gateway"
                ? gatewayOptions
                : {}),
            });
            if (result.object != null) return result.object;
            throw new RecursiveLookupError(
              target,
              result.failure,
              result.thrownError == null
                ? undefined
                : { cause: result.thrownError },
            );
          },
          { suppressErrors: command.suppressErrors, visited },
        );
      } catch (error) {
        if (command.reverse) {
          try {
            if (totalObjects > 0) {
              await writeSeparator(command.separator, getOutputStream());
            }
            await writeObjectToStream(
              current,
              command.output,
              command.format,
              contextLoader,
              getOutputStream(),
            );
            totalObjects++;
          } catch (writeError) {
            logger.error("Failed to write lookup output: {error}", {
              error: writeError,
            });
            spinner.fail("Failed to write output.");
            await finalizeAndExit(1);
            return;
          }
        }
        const failure = classifyRecursiveLookupFailure(error, {
          allowPrivateAddress: command.allowPrivateAddress,
          authorizedFetch: authLoader != null,
        });
        logger.error(
          "Failed to recursively fetch an object in chain: {error}",
          { error: failure.error },
        );
        printRecursiveLookupFailure(failure, spinner, command.timeout);
        await finalizeAndExit(1);
        return;
      }

      if (command.reverse) {
        const chainEntries = [
          { object: current, objectContextLoader: contextLoader },
          ...chain.map((next) => ({
            object: next,
            objectContextLoader: recursiveContextLoader,
          })),
        ];
        for (
          let chainIndex = chainEntries.length - 1;
          chainIndex >= 0;
          chainIndex--
        ) {
          const entry = chainEntries[chainIndex];
          try {
            if (totalObjects > 0 || chainIndex < chainEntries.length - 1) {
              await writeSeparator(command.separator, getOutputStream());
            }
            await writeObjectToStream(
              entry.object,
              command.output,
              command.format,
              entry.objectContextLoader,
              getOutputStream(),
            );
            totalObjects++;
          } catch (error) {
            logger.error("Failed to write lookup output: {error}", { error });
            spinner.fail("Failed to write output.");
            await finalizeAndExit(1);
            return;
          }
        }
      } else {
        const chainEntries = chain.map((next) => ({
          object: next,
          objectContextLoader: recursiveContextLoader,
        }));
        for (
          let chainIndex = 0;
          chainIndex < chainEntries.length;
          chainIndex++
        ) {
          const entry = chainEntries[chainIndex];
          try {
            if (totalObjects > 0 || chainIndex > 0) {
              await writeSeparator(command.separator, getOutputStream());
            }
            await writeObjectToStream(
              entry.object,
              command.output,
              command.format,
              entry.objectContextLoader,
              getOutputStream(),
            );
            totalObjects++;
          } catch (error) {
            logger.error("Failed to write lookup output: {error}", { error });
            spinner.fail("Failed to write output.");
            await finalizeAndExit(1);
            return;
          }
        }
      }
    }

    spinner.succeed("Successfully fetched all reachable objects in the chain.");
    await finalizeAndExit(0);
    return;
  }

  if (command.traverse) {
    let totalItems = 0;

    for (let urlIndex = 0; urlIndex < command.urls.length; urlIndex++) {
      const url = command.urls[urlIndex];

      if (urlIndex > 0) {
        spinner.text = `Looking up collection ${
          urlIndex + 1
        }/${command.urls.length}...`;
      }

      const result = await lookupDiagnosed(url, {
        documentLoader: initialAuthLoader ?? initialDocumentLoader,
        contextLoader,
        verifierDocumentLoader: authLoader ?? documentLoader,
        userAgent: command.userAgent,
        ...gatewayOptions,
      });
      const collection = result.object;
      if (collection == null) {
        if (
          result.thrownError instanceof TimeoutError ||
          result.failure?.error instanceof TimeoutError
        ) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
          const diagnostic = describeLookupFailure(
            result.failure,
            authLoader != null,
          );
          printError(message`${text(diagnostic.message)}`);
        }
        await finalizeAndExit(1);
        return;
      }
      if (!(collection instanceof Collection)) {
        spinner.fail(
          `Not a collection: ${colors.red(url)}.  ` +
            "The -t/--traverse option requires a collection.",
        );
        await finalizeAndExit(1);
        return;
      }
      spinner.succeed(`Fetched collection: ${colors.green(url)}.`);

      const diagnostics = createLookupDiagnostics(
        authLoader ?? documentLoader,
        contextLoader,
        authLoader ?? documentLoader,
      );
      try {
        if (command.reverse) {
          const {
            items: traversedItems,
            error: traversalError,
          } = await collectAsyncItems(
            effectiveDeps.traverseCollection(collection, {
              documentLoader: diagnostics.documentLoader,
              contextLoader: diagnostics.contextLoader,
              verifyPortableObject: diagnostics.verifyPortableObject,
              suppressError: command.suppressErrors,
              ...gatewayOptions,
            }),
          );
          for (let index = traversedItems.length - 1; index >= 0; index--) {
            const item = traversedItems[index];
            try {
              if (totalItems > 0) {
                await writeSeparator(command.separator, getOutputStream());
              }
              await writeObjectToStream(
                item,
                command.output,
                command.format,
                contextLoader,
                getOutputStream(),
              );
            } catch (error) {
              logger.error("Failed to write output for {url}: {error}", {
                url,
                error,
              });
              if (error instanceof TimeoutError) {
                handleTimeoutError(spinner, command.timeout, url);
              } else {
                spinner.fail(`Failed to write output for: ${colors.red(url)}.`);
                const diagnostic = describeLookupFailure(
                  { error, source: "other" },
                  authLoader != null,
                );
                printError(message`${text(diagnostic.message)}`);
              }
              await finalizeAndExit(1);
              return;
            }
            totalItems++;
          }
          if (traversalError != null) {
            throw traversalError;
          }
        } else {
          for await (
            const item of effectiveDeps.traverseCollection(collection, {
              documentLoader: diagnostics.documentLoader,
              contextLoader: diagnostics.contextLoader,
              verifyPortableObject: diagnostics.verifyPortableObject,
              suppressError: command.suppressErrors,
              ...gatewayOptions,
            })
          ) {
            try {
              if (totalItems > 0) {
                await writeSeparator(command.separator, getOutputStream());
              }
              await writeObjectToStream(
                item,
                command.output,
                command.format,
                contextLoader,
                getOutputStream(),
              );
            } catch (error) {
              logger.error("Failed to write output for {url}: {error}", {
                url,
                error,
              });
              if (error instanceof TimeoutError) {
                handleTimeoutError(spinner, command.timeout, url);
              } else {
                spinner.fail(`Failed to write output for: ${colors.red(url)}.`);
                const diagnostic = describeLookupFailure(
                  { error, source: "other" },
                  authLoader != null,
                );
                printError(message`${text(diagnostic.message)}`);
              }
              await finalizeAndExit(1);
              return;
            }
            totalItems++;
            diagnostics.clearFailures();
          }
        }
      } catch (error) {
        logger.error("Failed to complete the traversal for {url}: {error}", {
          url,
          error,
        });
        const failure = diagnostics.getContextFailure() ??
          diagnostics.getObjectFailure() ??
          diagnostics.getPortableFailure() ?? {
          error,
          source: "other" as const,
        };
        if (
          error instanceof TimeoutError || failure.error instanceof TimeoutError
        ) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(
            `Failed to complete the traversal for: ${colors.red(url)}.`,
          );
          if (isPrivateAddressError(failure.error)) {
            printLookupFailureHint(authLoader, failure.error);
          } else {
            const diagnostic = describeLookupFailure(
              failure,
              authLoader != null,
            );
            printError(message`${text(diagnostic.message)}`);
            if (
              !diagnostic.suggestsAuthorizedFetch && !command.suppressErrors
            ) {
              printError(
                message`Use the -S/--suppress-errors option to suppress partial errors.`,
              );
            }
          }
        }
        await finalizeAndExit(1);
        return;
      }
    }
    spinner.succeed("Successfully fetched all items in the collection.");

    await finalizeAndExit(0);
    return;
  }

  const objects = await Promise.all(
    command.urls.map((url) =>
      lookupDiagnosed(url, {
        documentLoader: initialAuthLoader ?? initialDocumentLoader,
        contextLoader,
        verifierDocumentLoader: authLoader ?? documentLoader,
        userAgent: command.userAgent,
        ...gatewayOptions,
      })
    ),
  );

  spinner.stop();
  let success = true;
  let printedCount = 0;
  const successfulObjects: APObject[] = [];
  for (const [i, result] of objects.entries()) {
    const obj = result.object;
    const url = command.urls[i];
    if (obj == null) {
      if (
        result.thrownError instanceof TimeoutError ||
        result.failure?.error instanceof TimeoutError
      ) {
        handleTimeoutError(spinner, command.timeout, url);
      } else {
        spinner.fail(`Failed to fetch ${colors.red(url)}`);
        const diagnostic = describeLookupFailure(
          result.failure,
          authLoader != null,
        );
        printError(message`${text(diagnostic.message)}`);
      }
      success = false;
    } else {
      spinner.succeed(`Fetched object: ${colors.green(url)}`);
      successfulObjects.push(obj);
    }
  }
  for (const obj of toPresentationOrder(successfulObjects, command.reverse)) {
    try {
      if (printedCount > 0) {
        await writeSeparator(command.separator, getOutputStream());
      }
      await writeObjectToStream(
        obj,
        command.output,
        command.format,
        contextLoader,
        getOutputStream(),
      );
    } catch (error) {
      logger.error("Failed to write lookup output: {error}", { error });
      spinner.fail("Failed to write output.");
      await finalizeAndExit(1);
      return;
    }
    printedCount++;
  }
  if (success) {
    spinner.succeed(
      command.urls.length > 1
        ? "Successfully fetched all objects."
        : "Successfully fetched the object.",
    );
  }
  if (!success) {
    await finalizeAndExit(1);
    return;
  }
  try {
    await closeWriteStream(outputStream);
    await server?.close();
  } catch (error) {
    logger.error("Failed to finalize lookup resources: {error}", { error });
    spinner.fail("Failed to finalize output.");
    await finalizeAndExit(1);
    return;
  }
  if (success && command.output) {
    spinner.succeed(
      `Successfully wrote output to ${colors.green(command.output)}.`,
    );
  }
}
