import {
  argument,
  choice,
  command,
  constant,
  float,
  type InferValue,
  map,
  message,
  multiple,
  object,
  option,
  optional,
  or,
  string,
  withDefault,
} from "@optique/core";
import { path } from "@optique/run/valueparser";
import {
  Collection,
  type DocumentLoader,
  type Link,
  lookupObject,
  Object as APObject,
  traverseCollection,
} from "@fedify/fedify";
import { getLogger } from "@logtape/logtape";
import ora from "ora";
import * as colors from "@std/fmt/colors";
import process from "node:process";
import { createWriteStream, type WriteStream } from "node:fs";
import { getContextLoader, getDocumentLoader } from "./docloader.ts";
import type { TemporaryServer } from "./tempserver.ts";
import { colorEnabled, formatObject } from "./utils.ts";
import { renderImages } from "./imagerenderer.ts";

const logger = getLogger(["fedify", "cli", "lookup"]);

export const lookupCommand = command(
  "lookup",
  object({
    command: constant("lookup"),
    authorizedFetch: object({
      enabled: option("-a", "--authorized-fetch", {
        description: message`Sign the request with an one-time key.`,
      }),
      firstKnock: withDefault(
        option(
          "--first-knock",
          choice(["draft-cavage-http-signatures-12", "rfc9421"]),
          {
            description:
              message`The first-knock spec for -a/--authorized-fetch. It is used for the double-knocking technique.`,
          },
        ),
        "draft-cavage-http-signatures-12",
      ),
    }),
    traverse: object({
      enabled: option("-t", "--traverse", {
        description:
          message`Traverse the given collection to fetch all items. If it is turned on, the argument cannot be multiple.`,
      }),
      suppressErrors: option("-S", "--suppress-errors", {
        description:
          message`Suppress partial errors while traversing the collection`,
      }),
    }),
    format: withDefault(
      or(
        map(
          option("-r", "--raw", {
            description: message`Print the fetched JSON-LD document as is.`,
          }),
          () => "raw" as const,
        ),
        map(
          option("-C", "--compact", {
            description: message`Compact the fetched JSON-LD document.`,
          }),
          () => "compact" as const,
        ),
        map(
          option("-e", "--expand", {
            description: message`Expand the fetched JSON-LD document.`,
          }),
          () => "expand" as const,
        ),
      ),
      "default" as const,
    ),
    userAgent: optional(
      option("-u", "--user-agent", string({ metavar: "USER_AGENT" }), {
        description: message`The custom User-Agent header value.`,
      }),
    ),
    separator: withDefault(
      option("-s", "--separator", string({ metavar: "SEPARATOR" }), {
        description:
          message`Specify the separator between adjacent output objects or collection items.`,
      }),
      "----",
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
    timeout: optional(option(
      "-T",
      "--timeout",
      float({ min: 0, metavar: "SECONDS" }),
      { description: message`Set timeout for network requests in seconds.` },
    )),
    urls: multiple(
      argument(string({ metavar: "URL_OR_HANDLE" }), {
        description: message`One or more URLs or handles to look up.`,
      }),
      { min: 1 },
    ),
  }),
  {
    description:
      message`Look up an Activity Streams object by URL or the actor handle. The argument can be either a URL or an actor handle (e.g., @username@domain), and it can be multiple.`,
  },
);

class TimeoutError extends Error {
  override name = "TimeoutError";
  constructor(message: string) {
    super(message);
  }
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
  command: InferValue<typeof lookupCommand>,
  contextLoader: DocumentLoader,
): Promise<void> {
  const stream: WriteStream | NodeJS.WritableStream = command.output
    ? createWriteStream(command.output)
    : process.stdout;

  let content;
  let json = true;
  let imageUrls: URL[] = [];

  if (command.format) {
    if (command.format === "raw") {
      content = await object.toJsonLd({ contextLoader });
    } else if (command.format === "compact") {
      content = await object.toJsonLd({ format: "compact", contextLoader });
    } else if (command.format === "expand") {
      content = await object.toJsonLd({ format: "expand", contextLoader });
    } else {
      content = object;
      json = false;
    }
  } else {
    content = object;
    json = false;
  }

  const enableColors = colorEnabled && command.output === undefined;
  content = formatObject(content, enableColors, json);

  const encoder = new TextEncoder();
  const bytes = encoder.encode(content + "\n");

  stream.write(bytes);

  if (object instanceof APObject) {
    imageUrls = await findAllImages(object);
  }
  if (!command.output && imageUrls.length > 0) {
    await renderImages(imageUrls);
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
  const urlText = url ? ` for: ${url}` : ""; // TODO: URL color should be red
  spinner.fail(`Request timed out after ${timeoutSeconds} seconds${urlText}.`);
  console.error(
    "Try increasing the timeout with -T/--timeout option or check network connectivity.",
  );
}

export async function runLookup(command: InferValue<typeof lookupCommand>) {
  // FIXME: Implement -t, --traverse when multiple URLs are provided
  if (command.urls.length < 1) {
    console.error("At least one URL or actor handle must be provided.");
    process.exit(1);
  } else if (command.traverse.enabled && command.urls.length > 1) {
    console.error(
      "The -t/--traverse option cannot be used with multiple arguments.",
    );
    process.exit(1);
  }
  const spinner = ora({
    text: `Looking up the ${
      command.traverse.enabled
        ? "collection"
        : command.urls.length > 1
        ? "objects"
        : "object"
    }...`,
    discardStdin: false,
  }).start();

  let server: TemporaryServer | undefined;
  const baseDocumentLoader = await getDocumentLoader({
    userAgent: command.userAgent,
  });
  const documentLoader = wrapDocumentLoaderWithTimeout(
    baseDocumentLoader,
    command.timeout,
  );
  const baseContextLoader = await getContextLoader({
    userAgent: command.userAgent,
  });
  const contextLoader = wrapDocumentLoaderWithTimeout(
    baseContextLoader,
    command.timeout,
  );
  //TODO: implement auth
  const authLoader: DocumentLoader | undefined = undefined;

  spinner.text = `Looking up the ${
    command.traverse.enabled
      ? "collection"
      : command.urls.length > 1
      ? "objects"
      : "object"
  }...`;

  if (command.traverse.enabled) {
    // FIXME: Implement traversal logic with multiple urls
    const url = command.urls[0];
    let collection: APObject | null;
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
        // TODO: Implement text colour
        spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
        if (authLoader == null) {
          console.error(
            "It may be a private object.  Try with -a/--authorized-fetch.",
          );
        }
      }
      await server?.close();
      process.exit(1);
    }

    if (collection == null) {
      spinner.fail(`Failed to fetch object: ${colors.red(url)}.`);
      if (authLoader == null) {
        console.error(
          "It may be a private object.  Try with -a/--authorized-fetch.",
        );
      }
      await server?.close();
      process.exit(1);
    }

    if (!(collection instanceof Collection)) {
      spinner.fail(
        `Not a collection: ${colors.red(url)}.  ` +
          "The -t/--traverse option requires a collection.",
      );
      await server?.close();
      process.exit(1);
    }

    spinner.succeed(`Fetched collection: ${colors.green(url)}.`);
    try {
      let i = 0;
      for await (
        const item of traverseCollection(collection, {
          documentLoader: authLoader ?? documentLoader,
          contextLoader,
          suppressError: command.traverse.suppressErrors,
        })
      ) {
        if (!command.output && i > 0) console.log(command.separator);
        await writeObjectToStream(item, command, contextLoader);
        i++;
      }
    } catch (error) {
      logger.error("Failed to complete the traversal: {error}", { error });
      if (error instanceof TimeoutError) {
        handleTimeoutError(spinner, command.timeout);
      } else {
        spinner.fail("Failed to complete the traversal.");
        if (authLoader == null) {
          console.error(
            "It may be a private object.  Try with -a/--authorized-fetch.",
          );
        } else {
          console.error(
            "Use the -S/--suppress-errors option to suppress partial errors.",
          );
        }
      }
      await server?.close();
      process.exit(1);
    }
    spinner.succeed("Successfully fetched all items in the collection.");
    await server?.close();
    process.exit(0);
  }

  //TODO: implement -a --authorized-fetch
  //let server: TemporaryServer | undefined = undefined;

  const promises: Promise<APObject | null>[] = [];

  for (const url of command.urls) {
    promises.push(
      lookupObject(url, {
        userAgent: command.userAgent,
      }).catch((error) => {
        if (error instanceof TimeoutError) {
          handleTimeoutError(spinner, command.timeout, url);
        }
        throw error;
      }),
    );
  }

  let objects: (APObject | null)[];
  try {
    objects = await Promise.all(promises);
  } catch (_error) {
    //TODO: implement -a --authorized-fetch
    // await server?.close();
    Deno.exit(1);
  }

  spinner.stop();
  let success = true;
  let i = 0;
  for (const obj of objects) {
    const url = command.urls[i];
    if (i > 0) console.log(command.separator);
    i++;
    if (obj == null) {
      spinner.fail(`Failed to fetch ${colors.red(url)}`);
      if (authLoader == null) {
        console.error(
          "It may be a private object.  Try with -a/--authorized-fetch.",
        );
      }
      success = false;
    } else {
      spinner.succeed(`Fetched object: ${colors.green(url)}`);
      await writeObjectToStream(obj, command, contextLoader);
      if (i < command.urls.length - 1) {
        console.log(command.separator);
      }
    }
  }
  if (success) {
    spinner.succeed(
      command.urls.length > 1
        ? "Successfully fetched all objects."
        : "Successfully fetched the object.",
    );
  }
  // TODO: implement -a --authorized-fetch
  // await server?.close();
  if (!success) {
    Deno.exit(1);
  }
  if (success && command.output) {
    spinner.succeed(
      `Successfully wrote output to ${colors.green(command.output)}.`,
    );
  }
}
