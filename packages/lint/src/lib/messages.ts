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
}: PropertyConfig): string => {
  const propertyPath = path.join(".");

  const recommendation = getter == null
    ? `Set the \`${propertyPath}\` property directly on the actor object.`
    : `Use \`${
      getExpectedCall({
        ctxName: "Context",
        methodName: getter,
        idName: "identifier",
        path: path.join("."),
        requiresIdentifier,
      })
    }\` for the \`${propertyPath}\` property URI.`;

  return `When \`${setter}\` is configured, the \`${propertyPath}\` ` +
    `property is recommended. ${recommendation}`;
};

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

/**
 * Error message for the deno-kv-store-deprecated rule.
 */
export const DENO_KV_STORE_DEPRECATED =
  "`DenoKvStore` from `@fedify/denokv` is deprecated since Fedify 2.5.0 and " +
  "will be removed in Fedify 3.0.0.  Use `SqliteKvStore` from " +
  "`@fedify/sqlite` for local or single-node deployments, or " +
  "`PostgresKvStore`, `RedisKvStore`, `MysqlKvStore`, or `WorkersKvStore` " +
  "for production.  See https://github.com/fedify-dev/fedify/issues/1336 " +
  "for the removal plan.";

/**
 * Error message for the deno-kv-message-queue-deprecated rule.
 */
export const DENO_KV_MESSAGE_QUEUE_DEPRECATED =
  "`DenoKvMessageQueue` from `@fedify/denokv` is deprecated since Fedify " +
  "2.5.0 and will be removed in Fedify 3.0.0.  Use `SqliteMessageQueue` from " +
  "`@fedify/sqlite` for local or single-node deployments, or " +
  "`PostgresMessageQueue`, `RedisMessageQueue`, `MysqlMessageQueue`, " +
  "`AmqpMessageQueue`, or `WorkersMessageQueue` for production.  See " +
  "https://github.com/fedify-dev/fedify/issues/1336 for the removal plan.";
