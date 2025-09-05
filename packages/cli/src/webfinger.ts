import { type ResourceDescriptor, toAcctUrl } from "@fedify/fedify";
import {
  lookupWebFinger,
  type LookupWebFingerOptions,
} from "@fedify/fedify/webfinger";
import { getLogger } from "@logtape/logtape";
import {
  argument,
  command,
  constant,
  flag,
  type InferValue,
  integer,
  merge,
  message,
  multiple,
  object,
  option,
  optional,
  string,
  withDefault,
} from "@optique/core";
import ora from "ora";
import { debugOption } from "./globals.ts";
import { formatObject } from "./utils.ts";

const logger = getLogger(["fedify", "cli", "webfinger"]);

const userAgent = optional(option(
  "-u",
  "--user-agent",
  string({ metavar: "USER_AGENT" }),
  {
    description: message`The custom User-Agent header value.`,
  },
));

const allowPrivateAddresses = optional(flag("-p", "--allow-private-address", {
  description: message`Allow private IP addresses in the URL.`,
}));

const maxRedirection = withDefault(
  option(
    "--max-redirection",
    integer({ min: 0 }),
    { description: message`Maximum number of redirections to follow.` },
  ),
  5,
);

export const webFingerCommand = command(
  "webfinger",
  merge(
    object({
      command: constant("webfinger"),
      resources: multiple(argument(string({ metavar: "RESOURCE" }), {
        description: message`WebFinger resource(s) to look up.`,
      })),
      userAgent,
      allowPrivateAddresses,
      maxRedirection,
    }),
    debugOption,
  ),
  {
    description:
      message`Look up WebFinger resources. The argument can be multiple.`,
  },
);

export async function runWebFinger(
  { command: _, resources, ...options }: InferValue<typeof webFingerCommand>,
) {
  await Array.fromAsync(
    resources.map((resource) => ({ resource, ...options })),
    spinnerWrapper(lookupSingleWebFinger),
  );
}

async function lookupSingleWebFinger<
  T extends LookupWebFingerOptions & { resource: string },
>({ resource, ...options }: T): Promise<ResourceDescriptor> {
  const url = convertUrlIfHandle(resource);
  const webFinger = await lookupWebFinger(url, options) ??
    new NotFoundError(resource).throw();
  return webFinger;
}

function spinnerWrapper<F extends typeof lookupSingleWebFinger>(
  func: (...args: Parameters<F>) => ReturnType<F>,
) {
  return async (...args: Parameters<F>) => {
    const spinner = ora({
      text: `Looking up WebFinger for ${args[0]}`,
      discardStdin: false,
    }).start();
    try {
      const result = await func(...args);
      spinner.succeed(`WebFinger found for ${args[0]}:`);
      console.log(formatObject(result, undefined, true));
    } catch (error) {
      spinner.fail(getErrorMessage(args[0].resource, error));
    }
  };
}

const getErrorMessage = (resource: string, error: unknown): string =>
  error instanceof InvalidHandleError
    ? `Invalid handle format: ${error.handle}`
    : error instanceof NotFoundError
    ? `Resource not found: ${error.resource}`
    : error instanceof Error
    ? `Error looking up WebFinger for ${resource}: ${error.message}`
    : `Error looking up WebFinger for ${resource}: ${error}`;

/**
 * Converts a handle or URL to a URL object.
 * If the input is a valid URL, it returns the URL object.
 * If the input is a handle in the format `@username@domain`, it converts it to a URL.
 * @param handleOrUrl The handle or URL to convert.
 * @returns A URL object representing the handle or URL.
 */
function convertUrlIfHandle(handleOrUrl: string): URL {
  try {
    return new URL(handleOrUrl); // Try to convert the input to a URL
  } catch {
    return convertHandleToUrl(handleOrUrl); // If it fails, treat it as a handle
  }
}

/**
 * Custom error class for invalid handle formats.
 * @param {string} handle The invalid handle that caused the error.
 * @extends {Error}
 */
class InvalidHandleError extends Error {
  constructor(public handle: string) {
    super(`Invalid handle format: ${handle}`);
    this.name = "InvalidHandleError";
  }
  throw(): never {
    throw this;
  }
}

/**
 * Custom error class for not found resources.
 * @param {string} resource The resource that was not found.
 * @extends {Error}
 */
class NotFoundError extends Error {
  constructor(public resource: string) {
    super(`Resource not found: ${resource}`);
    this.name = "NotFoundError";
  }
  throw(): never {
    throw this;
  }
}

/**
 * Converts a handle in the format `@username@domain` to a URL.
 * The resulting URL will be in the format `https://domain/@username`.
 * @param handle The handle to convert, in the format `@username@domain`.
 * @returns A URL object representing the handle.
 * @throws {Error} If the handle format is invalid.
 * @example
 * ```ts
 * const url = convertHandleToUrl("@username@domain.com");
 * console.log(url.toString()); // "https://domain.com/@username"
 * ```
 */
export function convertHandleToUrl(handle: string): URL {
  return toAcctUrl(handle) ?? // Convert the handle to a URL
    new InvalidHandleError(handle).throw(); // or throw an error if invalid
}
