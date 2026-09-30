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
    : error instanceof PortableActorError
    ? message`Failed to look up the portable actor ${error.resource}, as ${error.reason}.`
    : error instanceof UnlinkedPortableActorError
    ? message`${error.address} does not link back to the portable actor ${error.actorId}, so it is not verified to be the actor's WebFinger address:`
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

/**
 * Custom error class for [FEP-ef61] portable actors whose WebFinger address
 * cannot be determined.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param resource The portable actor's ID.
 * @param reason Why the WebFinger address cannot be determined.
 * @extends {Error}
 */
export class PortableActorError extends Error {
  constructor(public resource: string, public reason: string) {
    super(`Failed to look up the portable actor ${resource}, as ${reason}.`);
    this.name = "PortableActorError";
  }
}

/**
 * Custom error class for a WebFinger address that does not link back to
 * the [FEP-ef61] portable actor that claims it.
 *
 * [FEP-ef61]: https://w3id.org/fep/ef61
 * @param address The WebFinger address, e.g., `acct:alice@example.com`.
 * @param actorId The portable actor's ID.
 * @extends {Error}
 */
export class UnlinkedPortableActorError extends Error {
  constructor(public address: string, public actorId: string) {
    super(`${address} does not link back to the portable actor ${actorId}.`);
    this.name = "UnlinkedPortableActorError";
  }
}
