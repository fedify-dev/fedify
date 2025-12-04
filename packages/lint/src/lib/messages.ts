import { getArticle } from "./utils.ts";

/**
 * Generates error message for *-required rules.
 * Used when a property is missing from the actor dispatcher return value.
 *
 * @param propertyName - The property name (e.g., "id", "inbox", "following")
 */
export const actorPropertyRequired = (propertyName: string): string =>
  `Actor dispatcher must return an actor with ${
    getArticle(propertyName)
  } \`${propertyName}\` property.`;

/**
 * Generates error message for publicKey and assertionMethod required rules.
 * These use getActorKeyPairs instead of a property-specific getter.
 *
 * @param propertyName - The property name (e.g., "publicKey", "assertionMethod")
 */
export const actorKeyPropertyRequired = (propertyName: string): string =>
  `${
    actorPropertyRequired(propertyName)
  } Use \`Context.getActorKeyPairs(identifier)\` to retrieve key pairs.`;

/**
 * Generates error message for *-mismatch rules.
 * Used when a property exists but uses the wrong context method.
 *
 * @param propertyName - The property name or path (e.g., "id", "endpoints.sharedInbox")
 * @param expectedCall - The expected method call (e.g., "ctx.getActorUri(identifier)")
 */
export const actorPropertyMismatch = (
  propertyName: string,
  expectedCall: string,
): string =>
  `Actor's \`${propertyName}\` property must match \`${expectedCall}\`. Ensure you're using the correct context method.`;

/**
 * Error message for collection filtering not implemented.
 */
export const COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR =
  "Collection dispatcher should implement filtering to avoid large response " +
  "payloads. Add a fourth parameter (filter) to handle filtering. " +
  "See: https://fedify.dev/manual/collections#filtering-by-server";
