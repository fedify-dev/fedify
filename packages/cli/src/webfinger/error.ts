import { type Message, message } from "@optique/core";

/**
 * Generates a user-friendly error message based on the type of error
 * encountered during WebFinger lookup.
 * @param {string} resource The resource being looked up.
 * @param {unknown} error The error encountered.
 * @returns {string} A descriptive error message.
 */
export const getErrorMessage = (resource: string, error: unknown): Message =>
  error instanceof InvalidHandleError
    ? message`Invalid handle format: ${error.handle}`
    : error instanceof NotFoundError
    ? message`Resource not found: ${error.resource}`
    : error instanceof Error
    ? message`Failed to look up WebFinger for ${resource}: ${error.message}`
    : message`Failed to look up WebFinger for ${resource}: ${String(error)}`;

/**
 * Custom error class for invalid handle formats.
 * @param {string} handle The invalid handle that caused the error.
 * @extends {Error}
 */
export class InvalidHandleError extends Error {
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
export class NotFoundError extends Error {
  constructor(public resource: string) {
    super(`Resource not found: ${resource}`);
    this.name = "NotFoundError";
  }
  throw(): never {
    throw this;
  }
}
