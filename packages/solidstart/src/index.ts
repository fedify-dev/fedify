/**
 * Fedify with SolidStart
 * ======================
 *
 * This package provides a [SolidStart] middleware to integrate with the Fedify.
 *
 * [SolidStart]: https://start.solidjs.com/
 *
 * @module
 * @since 2.2.0
 */

import type { Federation } from "@fedify/fedify/federation";
import { createMiddleware } from "@solidjs/start/middleware";
import {
  type ContextDataFactory,
  createOnBeforeResponseHandler,
  createOnRequestHandler,
} from "./handlers.ts";

export type { ContextDataFactory } from "./handlers.ts";

/**
 * Create a SolidStart middleware to integrate with the {@link Federation}
 * object.
 *
 * @example src/middleware/index.ts
 * ``` typescript
 * import { fedifyMiddleware } from "@fedify/solidstart";
 * import federation from "../lib/federation";
 *
 * export default fedifyMiddleware(federation);
 * ```
 *
 * @template TContextData A type of the context data for the
 *                         {@link Federation} object.
 * @param federation A {@link Federation} object to integrate with SolidStart.
 * @param createContextData A function to create context data for the
 *                          {@link Federation} object.
 * @returns A SolidStart middleware object.
 * @since 2.2.0
 */
export function fedifyMiddleware<TContextData>(
  federation: Federation<TContextData>,
  createContextData: ContextDataFactory<TContextData> = () =>
    undefined as TContextData,
): ReturnType<typeof createMiddleware> {
  return createMiddleware({
    onRequest: createOnRequestHandler(federation, createContextData),
    onBeforeResponse: createOnBeforeResponseHandler(),
  });
}
