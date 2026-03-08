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
import type { DocumentLoader } from "@fedify/vocab-runtime";
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
const QUOTE_URL_IRI = "https://www.w3.org/ns/activitystreams#quoteUrl";
const MISSKEY_QUOTE_IRI = "https://misskey-hub.net/ns#_misskey_quote";
const FEDIBIRD_QUOTE_IRI = "http://fedibird.com/ns#quoteUri";
const recurseProperties = [
  "replyTarget",
  "quoteUrl",
  IN_REPLY_TO_IRI,
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
    description:
      message`Allow private IP addresses for explicit lookup/traverse requests.`,
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
    tunnelService: createTunnelServiceOption(),
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
    message`Try increasing the timeout with -T/--timeout option or check network connectivity.`,
  );
}

/**
 * Gets the next recursion target URL from an ActivityPub object.
 */
export function getRecursiveTargetId(
  object: APObject,
  recurseProperty: RecurseProperty,
): URL | null {
  if (
    recurseProperty === "replyTarget" || recurseProperty === IN_REPLY_TO_IRI
  ) {
    return object.replyTargetId;
  }
  if (
    recurseProperty === "quoteUrl" || recurseProperty === QUOTE_URL_IRI ||
    recurseProperty === MISSKEY_QUOTE_IRI ||
    recurseProperty === FEDIBIRD_QUOTE_IRI
  ) {
    const quoteUrl = (object as { quoteUrl?: unknown }).quoteUrl;
    return quoteUrl instanceof URL ? quoteUrl : null;
  }
  return null;
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
) {
  if (command.urls.length < 1) {
    printError(message`At least one URL or actor handle must be provided.`);
    process.exit(1);
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
    process.exit(cleanupFailed && code === 0 ? 1 : code);
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
    const recursiveBaseDocumentLoader = await getDocumentLoader({
      userAgent: command.userAgent,
      allowPrivateAddress: false,
    });
    const recursiveDocumentLoader = wrapDocumentLoaderWithTimeout(
      recursiveBaseDocumentLoader,
      command.timeout,
    );
    const recursiveBaseContextLoader = await getContextLoader({
      userAgent: command.userAgent,
      allowPrivateAddress: false,
    });
    const recursiveContextLoader = wrapDocumentLoaderWithTimeout(
      recursiveBaseContextLoader,
      command.timeout,
    );
    const recursiveAuthLoader = command.authorizedFetch &&
        authIdentity != null
      ? wrapDocumentLoaderWithTimeout(
        getAuthenticatedDocumentLoader(
          authIdentity,
          {
            allowPrivateAddress: false,
            userAgent: command.userAgent,
            specDeterminer: {
              determineSpec() {
                return command.firstKnock;
              },
              rememberSpec() {
              },
            },
          },
        ),
        command.timeout,
      )
      : undefined;
    const initialLookupDocumentLoader: DocumentLoader = authLoader ??
      documentLoader;
    const recursiveLookupDocumentLoader: DocumentLoader = recursiveAuthLoader ??
      recursiveDocumentLoader;
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
        current = await lookupObject(url, {
          documentLoader: initialLookupDocumentLoader,
          contextLoader,
          userAgent: command.userAgent,
        });
      } catch (error) {
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
          if (authLoader == null) {
            printError(
              message`It may be a private object.  Try with -a/--authorized-fetch.`,
            );
          }
        }
        await finalizeAndExit(1);
        return;
      }
      if (current == null) {
        spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
        if (authLoader == null) {
          printError(
            message`It may be a private object.  Try with -a/--authorized-fetch.`,
          );
        }
        await finalizeAndExit(1);
        return;
      }

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
      } catch (error) {
        logger.error("Failed to write lookup output: {error}", { error });
        spinner.fail("Failed to write output.");
        await finalizeAndExit(1);
        return;
      }
      totalObjects++;
      visited.add(url);
      if (current.id != null) {
        visited.add(current.id.href);
      }

      let chain: APObject[] = [];
      try {
        chain = await collectRecursiveObjects(
          current,
          command.recurse,
          recurseDepth,
          (target) =>
            lookupObject(target, {
              documentLoader: recursiveLookupDocumentLoader,
              contextLoader: recursiveContextLoader,
              userAgent: command.userAgent,
            }),
          { suppressErrors: command.suppressErrors, visited },
        );
      } catch (error) {
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
          if (authLoader == null) {
            printError(
              message`It may be a private object.  Try with -a/--authorized-fetch.`,
            );
          }
        } else {
          spinner.fail("Failed to recursively fetch object.");
          if (authLoader == null) {
            printError(
              message`It may be a private object.  Try with -a/--authorized-fetch.`,
            );
          } else {
            printError(
              message`Use the -S/--suppress-errors option to suppress partial errors.`,
            );
          }
        }
        await finalizeAndExit(1);
        return;
      }

      for (const next of chain) {
        try {
          await writeSeparator(command.separator, getOutputStream());
          await writeObjectToStream(
            next,
            command.output,
            command.format,
            recursiveContextLoader,
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
        collection = await lookupObject(url, {
          documentLoader: authLoader ?? documentLoader,
          contextLoader,
          userAgent: command.userAgent,
        });
      } catch (error) {
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout, url);
        } else {
          spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
          if (authLoader == null) {
            printError(
              message`It may be a private object.  Try with -a/--authorized-fetch.`,
            );
          }
        }
        await finalizeAndExit(1);
        return;
      }
      if (collection == null) {
        spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
        if (authLoader == null) {
          printError(
            message`It may be a private object.  Try with -a/--authorized-fetch.`,
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
        let collectionItems = 0;
        for await (
          const item of traverseCollection(collection, {
            documentLoader: authLoader ?? documentLoader,
            contextLoader,
            suppressError: command.suppressErrors,
          })
        ) {
          try {
            if (totalItems > 0 || collectionItems > 0) {
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
          collectionItems++;
          totalItems++;
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
          if (authLoader == null) {
            printError(
              message`It may be a private object.  Try with -a/--authorized-fetch.`,
            );
          } else {
            printError(
              message`Use the -S/--suppress-errors option to suppress partial errors.`,
            );
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
      lookupObject(url, {
        documentLoader: authLoader ?? documentLoader,
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
  for (const [i, obj] of objects.entries()) {
    const url = command.urls[i];
    if (obj == null) {
      spinner.fail(`Failed to fetch ${colors.red(url)}`);
      if (authLoader == null) {
        printError(
          message`It may be a private object.  Try with -a/--authorized-fetch.`,
        );
      }
      success = false;
    } else {
      spinner.succeed(`Fetched object: ${colors.green(url)}`);
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
