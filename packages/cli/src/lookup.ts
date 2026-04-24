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
  isValidPublicIPv4Address,
  isValidPublicIPv6Address,
  UrlError,
} from "@fedify/vocab-runtime";
import type { ResourceDescriptor } from "@fedify/webfinger";
import { getLogger } from "@logtape/logtape";
import { bindConfig } from "@optique/config";
import {
  argument,
  choice,
  command,
  constant,
  flag,
  float,
  type InferValue,
  integer,
  map,
  merge,
  message,
  multiple,
  object,
  option,
  optional,
  optionNames,
  or,
  string,
  withDefault,
} from "@optique/core";
import { url as messageUrl } from "@optique/core/message";
import { path, printError } from "@optique/run";
import { createWriteStream, type WriteStream } from "node:fs";
import process from "node:process";
import ora from "ora";
import { configContext } from "./config.ts";
import { getContextLoader, getDocumentLoader } from "./docloader.ts";
import { renderImages } from "./imagerenderer.ts";
import { configureLogging } from "./log.ts";
import {
  createTunnelServiceOption,
  type GlobalOptions,
  userAgentOption,
} from "./options.ts";
import { spawnTemporaryServer, type TemporaryServer } from "./tempserver.ts";
import { colorEnabled, colors, formatObject } from "./utils.ts";

const logger = getLogger(["fedify", "cli", "lookup"]);

const IN_REPLY_TO_IRI = "https://www.w3.org/ns/activitystreams#inReplyTo";
const QUOTE_IRI = "https://w3id.org/fep/044f#quote";
const QUOTE_URL_IRI = "https://www.w3.org/ns/activitystreams#quoteUrl";
const MISSKEY_QUOTE_IRI = "https://misskey-hub.net/ns#_misskey_quote";
const FEDIBIRD_QUOTE_IRI = "http://fedibird.com/ns#quoteUri";
const recurseProperties = [
  "replyTarget",
  "quote",
  "quoteUrl",
  IN_REPLY_TO_IRI,
  QUOTE_IRI,
  QUOTE_URL_IRI,
  MISSKEY_QUOTE_IRI,
  FEDIBIRD_QUOTE_IRI,
] as const;
type RecurseProperty = typeof recurseProperties[number];

const suppressErrorsOption = bindConfig(
  flag("-S", "--suppress-errors", {
    description:
      message`Suppress partial errors during traversal or recursion.`,
  }),
  {
    context: configContext,
    key: (config) => config.lookup?.suppressErrors ?? false,
    default: false,
  },
);

const allowPrivateAddressOption = bindConfig(
  flag("-p", "--allow-private-address", {
    description: message`Allow private IP addresses for URLs discovered \
during traversal or recursive object fetches. Recursive JSON-LD \
context URLs always remain blocked. URLs explicitly provided on the \
command line always allow private addresses.`,
  }),
  {
    context: configContext,
    key: (config) => config.lookup?.allowPrivateAddress ?? false,
    default: false,
  },
);

export const authorizedFetchOption = withDefault(
  object("Authorized fetch options", {
    authorizedFetch: bindConfig(
      map(
        flag("-a", "--authorized-fetch", {
          description: message`Sign the request with an one-time key.`,
        }),
        () => true as const,
      ),
      {
        context: configContext,
        key: (config) => config.lookup?.authorizedFetch ? true : undefined,
      },
    ),
    firstKnock: bindConfig(
      option(
        "--first-knock",
        choice(["draft-cavage-http-signatures-12", "rfc9421"]),
        {
          description: message`The first-knock spec for ${
            optionNames(["-a", "--authorized-fetch"])
          }. It is used for the double-knocking technique.`,
        },
      ),
      {
        context: configContext,
        key: (config) =>
          config.lookup?.firstKnock ?? "draft-cavage-http-signatures-12",
        default: "draft-cavage-http-signatures-12" as const,
      },
    ),
    tunnelService: optional(createTunnelServiceOption()),
  }),
  {
    authorizedFetch: false as const,
    firstKnock: undefined,
    tunnelService: undefined,
  } as const,
);

const lookupModeOption = withDefault(
  or(
    object("Recurse options", {
      traverse: constant(false as const),
      recurse: bindConfig(
        option(
          "--recurse",
          choice(recurseProperties, { metavar: "PROPERTY" }),
          {
            description: message`Recursively follow a relationship property.`,
          },
        ),
        {
          context: configContext,
          key: (config) => config.lookup?.recurse,
        },
      ),
      recurseDepth: withDefault(
        bindConfig(
          option(
            "--recurse-depth",
            integer({ min: 1, metavar: "DEPTH" }),
            {
              description: message`Maximum recursion depth for ${
                optionNames(["--recurse"])
              }.`,
            },
          ),
          {
            context: configContext,
            key: (config) => config.lookup?.recurseDepth,
          },
        ),
        20,
      ),
      suppressErrors: suppressErrorsOption,
    }),
    object("Traverse options", {
      traverse: bindConfig(
        flag("-t", "--traverse", {
          description:
            message`Traverse the given collection(s) to fetch all items.`,
        }),
        {
          context: configContext,
          key: (config) => config.lookup?.traverse ?? false,
          default: false,
        },
      ),
      recurse: constant(undefined),
      recurseDepth: constant(undefined),
      suppressErrors: suppressErrorsOption,
    }),
  ),
  {
    traverse: false,
    recurse: undefined,
    recurseDepth: undefined,
    suppressErrors: false,
  } as const,
);

export const lookupCommand = command(
  "lookup",
  merge(
    object({ command: constant("lookup") }),
    lookupModeOption,
    authorizedFetchOption,
    merge(
      "Network options",
      userAgentOption,
      object({
        allowPrivateAddress: allowPrivateAddressOption,
        timeout: optional(
          bindConfig(
            option(
              "-T",
              "--timeout",
              float({ min: 0, metavar: "SECONDS" }),
              {
                description:
                  message`Set timeout for network requests in seconds.`,
              },
            ),
            {
              context: configContext,
              key: (config) => config.lookup?.timeout,
            },
          ),
        ),
      }),
    ),
    object("Arguments", {
      urls: multiple(
        argument(string({ metavar: "URL_OR_HANDLE" }), {
          description: message`One or more URLs or handles to look up.`,
        }),
        { min: 1 },
      ),
    }),
    object("Output options", {
      reverse: bindConfig(
        flag("--reverse", {
          description:
            message`Reverse the output order of fetched objects or items.`,
        }),
        {
          context: configContext,
          key: (config) => config.lookup?.reverse ?? false,
          default: false,
        },
      ),
      format: bindConfig(
        optional(
          or(
            map(
              flag("-r", "--raw", {
                description: message`Print the fetched JSON-LD document as is.`,
              }),
              () => "raw" as const,
            ),
            map(
              flag("-C", "--compact", {
                description: message`Compact the fetched JSON-LD document.`,
              }),
              () => "compact" as const,
            ),
            map(
              flag("-e", "--expand", {
                description: message`Expand the fetched JSON-LD document.`,
              }),
              () => "expand" as const,
            ),
          ),
        ),
        {
          context: configContext,
          key: (config) => config.lookup?.defaultFormat ?? "default",
          default: "default",
        },
      ),
      separator: bindConfig(
        option("-s", "--separator", string({ metavar: "SEPARATOR" }), {
          description:
            message`Specify the separator between adjacent output objects or collection items.`,
        }),
        {
          context: configContext,
          key: (config) => config.lookup?.separator ?? "----",
          default: "----",
        },
      ),
      output: optional(option(
        "-o",
        "--output",
        path({
          metavar: "OUTPUT_PATH",
          type: "file",
          allowCreate: true,
        }),
        { description: message`Specify the output file path.` },
      )),
    }),
  ),
  {
    brief: message`Look up Activity Streams objects.`,
    description:
      message`Look up Activity Streams objects by URL or actor handle.

The arguments can be either URLs or actor handles (e.g., ${"@username@domain"}), and they can be multiple.`,
  },
);

export class TimeoutError extends Error {
  override name = "TimeoutError";
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Error thrown when a recursive lookup target cannot be fetched.
 */
export class RecursiveLookupError extends Error {
  target: string;
  constructor(target: string) {
    super(`Failed to recursively fetch object: ${target}`);
    this.name = "RecursiveLookupError";
    this.target = target;
  }
}

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

const signalTimers = new WeakMap<AbortSignal, number>();

export function createTimeoutSignal(
  timeoutSeconds?: number,
): AbortSignal | undefined {
  if (timeoutSeconds == null) return undefined;
  const controller = new AbortController();
  const timerId = setTimeout(() => {
    controller.abort(
      new TimeoutError(`Request timed out after ${timeoutSeconds} seconds`),
    );
  }, timeoutSeconds * 1000);

  signalTimers.set(controller.signal, timerId);

  return controller.signal;
}

export function clearTimeoutSignal(signal?: AbortSignal): void {
  if (!signal) return;
  const timerId = signalTimers.get(signal);
  if (timerId !== undefined) {
    clearTimeout(timerId);
    signalTimers.delete(signal);
  }
}

function wrapDocumentLoaderWithTimeout(
  loader: DocumentLoader,
  timeoutSeconds?: number,
): DocumentLoader {
  if (timeoutSeconds == null) return loader;

  return (url: string, options?) => {
    const signal = createTimeoutSignal(timeoutSeconds);
    return loader(url, { ...options, signal }).finally(() =>
      clearTimeoutSignal(signal)
    );
  };
}

function handleTimeoutError(
  spinner: { fail: (text: string) => void },
  timeoutSeconds?: number,
  url?: string,
): void {
  const urlText = url ? ` for: ${colors.red(url)}` : "";
  spinner.fail(`Request timed out after ${timeoutSeconds} seconds${urlText}.`);
  printError(
    message`Try increasing the timeout with ${
      optionNames(["-T", "--timeout"])
    } option or check network connectivity.`,
  );
}

function isPrivateAddressError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();
  if (error instanceof UrlError) {
    return (
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
  if (typeof candidate !== "string" && !(candidate instanceof URL)) return null;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname;
    if (hostname === "localhost") return url;

    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return isValidPublicIPv4Address(hostname) ? null : url;
    }

    const normalized = hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
    if (normalized.includes(":")) {
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
  // This detection intentionally depends on jsonld's current error shape:
  // name === "jsonld.InvalidUrl", the "valid JSON-LD object" substring, and
  // a trailing `URL: "..."` segment all at once. If jsonld changes those
  // details, this helper and the related lookup tests need to be updated
  // together.
  const errorMessage = error instanceof Error ? error.message : String(error);
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
): "private-address" | "recursive-private-address" | "authorized-fetch" {
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
    visited.add(current.id.href);
  }

  for (let depth = 0; depth < recurseDepth; depth++) {
    const targetId = getRecursiveTargetId(current, recurseProperty);
    if (targetId == null) break;
    const target = targetId.href;
    if (visited.has(target)) break;

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
    visited.add(target);
    if (next.id != null) {
      visited.add(next.id.href);
    }
    current = next;
  }

  return results;
}

export async function runLookup(
  command: InferValue<typeof lookupCommand> & GlobalOptions,
  deps: Partial<{
    lookupObject: typeof lookupObject;
    traverseCollection: typeof traverseCollection;
    exit: (code: number) => never;
  }> = {},
) {
  const effectiveDeps: {
    lookupObject: typeof lookupObject;
    traverseCollection: typeof traverseCollection;
    exit: (code: number) => never;
  } = {
    lookupObject,
    traverseCollection,
    exit: (code: number) => process.exit(code),
    ...deps,
  };

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
  const initialBaseDocumentLoader = await getDocumentLoader({
    userAgent: command.userAgent,
    allowPrivateAddress: true,
  });
  const initialDocumentLoader = wrapDocumentLoaderWithTimeout(
    initialBaseDocumentLoader,
    command.timeout,
  );
  const baseDocumentLoader = await getDocumentLoader({
    userAgent: command.userAgent,
    allowPrivateAddress: command.allowPrivateAddress,
  });
  const documentLoader = wrapDocumentLoaderWithTimeout(
    baseDocumentLoader,
    command.timeout,
  );
  const baseContextLoader = await getContextLoader({
    userAgent: command.userAgent,
    allowPrivateAddress: command.allowPrivateAddress,
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
        specDeterminer: {
          determineSpec() {
            return command.firstKnock;
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
        specDeterminer: {
          determineSpec() {
            return command.firstKnock;
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
    const recursiveBaseContextLoader = await getContextLoader({
      userAgent: command.userAgent,
      allowPrivateAddress: false,
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
      let current: APObject | null = null;
      try {
        current = await effectiveDeps.lookupObject(url, {
          documentLoader: initialLookupDocumentLoader,
          contextLoader,
          userAgent: command.userAgent,
        });
      } catch (error) {
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
          printLookupFailureHint(authLoader, error);
        }
        await finalizeAndExit(1);
        return;
      }
      if (current == null) {
        spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
        if (authLoader == null) {
          printError(
            message`It may be a private object.  Try with ${
              optionNames(["-a", "--authorized-fetch"])
            }.`,
          );
        }
        await finalizeAndExit(1);
        return;
      }

      visited.add(url);
      if (current.id != null) {
        visited.add(current.id.href);
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
          (target) =>
            effectiveDeps.lookupObject(target, {
              documentLoader: recursiveLookupDocumentLoader,
              contextLoader: recursiveContextLoader,
              userAgent: command.userAgent,
            }),
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
        logger.error(
          "Failed to recursively fetch an object in chain: {error}",
          {
            error,
          },
        );
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout);
        } else if (error instanceof RecursiveLookupError) {
          spinner.fail(
            `Failed to recursively fetch object: ${colors.red(error.target)}.`,
          );
          if (
            !command.allowPrivateAddress &&
            isPrivateAddressTarget(error.target)
          ) {
            printRecursivePrivateAddressHint();
          } else if (authLoader == null) {
            printError(
              message`It may be a private object.  Try with ${
                optionNames(["-a", "--authorized-fetch"])
              }.`,
            );
          }
        } else {
          spinner.fail("Failed to recursively fetch object.");
          const privateContextUrl = getPrivateContextUrl(error);
          if (privateContextUrl != null) {
            printRecursivePrivateContextHint(privateContextUrl);
            await finalizeAndExit(1);
            return;
          }
          const hint = getLookupFailureHint(error, { recursive: true });
          if (shouldSuggestSuppressErrorsForLookupFailure(authLoader, hint)) {
            printError(
              message`Use the ${
                optionNames(["-S", "--suppress-errors"])
              } option to suppress partial errors.`,
            );
          } else {
            printLookupFailureHint(authLoader, error, { recursive: true });
          }
        }
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

      let collection: APObject | null = null;
      try {
        collection = await effectiveDeps.lookupObject(url, {
          documentLoader: initialAuthLoader ?? initialDocumentLoader,
          contextLoader,
          userAgent: command.userAgent,
        });
      } catch (error) {
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
          printLookupFailureHint(authLoader, error);
        }
        await finalizeAndExit(1);
        return;
      }
      if (collection == null) {
        spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
        if (authLoader == null) {
          printError(
            message`It may be a private object.  Try with ${
              optionNames(["-a", "--authorized-fetch"])
            }.`,
          );
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

      try {
        if (command.reverse) {
          const {
            items: traversedItems,
            error: traversalError,
          } = await collectAsyncItems(
            effectiveDeps.traverseCollection(collection, {
              documentLoader: authLoader ?? documentLoader,
              contextLoader,
              suppressError: command.suppressErrors,
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
              spinner.fail(`Failed to write output for: ${colors.red(url)}.`);
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
              documentLoader: authLoader ?? documentLoader,
              contextLoader,
              suppressError: command.suppressErrors,
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
              spinner.fail(`Failed to write output for: ${colors.red(url)}.`);
              await finalizeAndExit(1);
              return;
            }
            totalItems++;
          }
        }
      } catch (error) {
        logger.error("Failed to complete the traversal for {url}: {error}", {
          url,
          error,
        });
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(
            `Failed to complete the traversal for: ${colors.red(url)}.`,
          );
          const hint = getLookupFailureHint(error);
          if (shouldSuggestSuppressErrorsForLookupFailure(authLoader, hint)) {
            printError(
              message`Use the ${
                optionNames(["-S", "--suppress-errors"])
              } option to suppress partial errors.`,
            );
          } else {
            printLookupFailureHint(authLoader, error);
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

  const promises: Promise<APObject | null>[] = [];

  for (const url of command.urls) {
    promises.push(
      effectiveDeps.lookupObject(url, {
        documentLoader: initialAuthLoader ?? initialDocumentLoader,
        contextLoader,
        userAgent: command.userAgent,
      }).catch((error) => {
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout, url);
        }
        throw error;
      }),
    );
  }

  let objects: (APObject | null)[] = [];
  try {
    objects = await Promise.all(promises);
  } catch (_error) {
    await finalizeAndExit(1);
    return;
  }

  spinner.stop();
  let success = true;
  let printedCount = 0;
  const successfulObjects: APObject[] = [];
  for (const [i, obj] of objects.entries()) {
    const url = command.urls[i];
    if (obj == null) {
      spinner.fail(`Failed to fetch ${colors.red(url)}`);
      if (authLoader == null) {
        printError(
          message`It may be a private object.  Try with ${
            optionNames(["-a", "--authorized-fetch"])
          }.`,
        );
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
