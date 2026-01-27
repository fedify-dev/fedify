import { toAcctUrl } from "@fedify/vocab";
import { getLogger } from "@logtape/logtape";
import { InvalidHandleError } from "./error.ts";

export const logger = getLogger(["fedify", "cli", "webfinger"]);

/**
 * Converts a handle or URL to a URL object.
 * If the input is a valid URL, it returns the URL object.
 * If the input is a handle in the format `@username@domain`, it converts it to a URL.
 * @param handleOrUrl The handle or URL to convert.
 * @returns A URL object representing the handle or URL.
 */
export function convertUrlIfHandle(handleOrUrl: string): URL {
  try {
    return new URL(handleOrUrl); // Try to convert the input to a URL
  } catch {
    return convertHandleToUrl(handleOrUrl); // If it fails, treat it as a handle
  }
}

/**
 * Converts a handle in the format `@username@domain` to a URL.
 * The resulting URL will be in the format `acct:username@domain`.
 * @param handle The handle to convert, in the format `@username@domain`.
 * @returns A URL object representing the handle.
 * @throws {Error} If the handle format is invalid.
 * @example
 * ```ts
 * const url = convertHandleToUrl("@username@domain.com");
 * console.log(url.toString()); // "acct:username@domain.com"
 * ```
 */
export function convertHandleToUrl(handle: string): URL {
  return toAcctUrl(handle) ?? // Convert the handle to a URL
    new InvalidHandleError(handle).throw(); // or throw an error if invalid
}
