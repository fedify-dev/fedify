import { Command, ValidationError } from "@cliffy/command";
import { toAcctUrl } from "@fedify/fedify/vocab";
import { lookupWebFinger } from "@fedify/fedify/webfinger";
import ora from "ora";
import { printJson } from "./utils.ts";

export const command = new Command()
  .arguments("<...resources:string>")
  .description(
    "Look up a WebFinger resource by resource. The argument can be multiple.",
  )
  .option(
    "-a, --user-agent <userAgent:string>",
    "The user agent to use for the request.",
  )
  .option(
    "-p, --allow-private-address",
    "Allow private IP addresses in the URL.",
  )
  .option(
    "--max-redirection <maxRedirection:integer>",
    "Maximum number of redirections to follow.",
    { default: 5 },
  )
  .action(async (options, ...resources: string[]) => {
    if (options.maxRedirection < 0) { // Validate maxRedirection option
      throw new ValidationError(
        `Option --max-redirection must be greater than or equal to 0, but got ${options.maxRedirection}.`,
      );
    }

    for (const resource of resources) {
      const spinner = ora({ // Create a spinner for the lookup process
        text: `Looking up WebFinger for ${resource}`,
        discardStdin: false,
      }).start();
      try {
        const url = convertUrlIfHandle(resource); // Convert resource to URL
        const webFinger = await lookupWebFinger(url, options) ?? // Look up WebFinger
          new NotFoundError(resource).throw(); // throw NotFoundError if not found

        spinner.succeed(`WebFinger found for ${resource}:`); // Succeed the spinner
        printJson(webFinger); // Print the WebFinger
      } catch (error) {
        if (error instanceof InvalidHandleError) { // If the handle format is invalid,
          spinner.fail(`Invalid handle format: ${error.handle}`); // log error message with handle
        } else if (error instanceof NotFoundError) { // If the resource is not found,
          spinner.fail(`Resource not found: ${error.resource}`); // log not found message
        } else if (error instanceof Error) {
          spinner.fail( // For other errors, log the error message
            `Error looking up WebFinger for ${resource}: ${error}`,
          );
        }
      }
    }
  });

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
