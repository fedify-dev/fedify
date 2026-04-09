import { Federation } from "@fedify/fedify";
import type { FrameworkMiddlewareHandler } from "프레임워크";

// `FrameworkContext` could be unnecessary.
// Remove it if the framework's middleware handler does not provide a context object.

export type ContextDataFactory<TContextData, FrameworkContext> = (
  context: FrameworkContext,
) => TContextData | Promise<TContextData>;

export function fedifyMiddleware<TContextData, FrameworkContext>(
  federation: Federation<TContextData>,
  contextDataFactory: ContextDataFactory<TContextData, FrameworkContext> =
    (() => void 0 as TContextData),
): FrameworkMiddlewareHandler {
  // Implement handler or middleware
}
