import type { MethodCallContext, PropertyConfig } from "./types.ts";

/**
 * Generates error message for *-required rules.
 * Used when a property is missing from the actor dispatcher return value.
 *
 * @param name - The property name (e.g., "id", "inbox", "following")
 */
export const actorPropertyRequired = ({
  setter,
  path,
  getter,
  requiresIdentifier = true,
}: PropertyConfig): string =>
  `When \`${setter}\` is configured, the \`${
    path.join(".")
  }\` property is recommended. Use \`${
    getExpectedCall({
      ctxName: "Context",
      methodName: getter,
      idName: "identifier",
      path: path.join("."),
      requiresIdentifier,
    })
  }\` for the \`${path.join(".")}\` property URI.`;

/**
 * Generates error message for *-mismatch rules.
 * Used when a property exists but uses the wrong context method.
 *
 * @param propertyName - The property name or path
 *                       (e.g., "id", "endpoints.sharedInbox")
 * @param expectedCall - The expected method call
 *                       (e.g., "ctx.getActorUri(identifier)")
 */
export const actorPropertyMismatch = (
  context: MethodCallContext,
): string =>
  `Actor's \`${context.path}\` property must match \`${
    getExpectedCall(context)
  }\`. \
Ensure you're using the correct context method.`;

const getExpectedCall = (
  { ctxName, methodName, requiresIdentifier, idName }: MethodCallContext,
): string =>
  requiresIdentifier
    ? `${ctxName}.${methodName}(${idName})`
    : `${ctxName}.${methodName}()`;

/**
 * Error message for collection filtering not implemented.
 */
export const COLLECTION_FILTERING_NOT_IMPLEMENTED_ERROR =
  "Collection dispatcher should implement filtering to avoid large response " +
  "payloads. Add a fourth parameter (filter) to handle filtering. " +
  "See: https://fedify.dev/manual/collections#filtering-by-server";
