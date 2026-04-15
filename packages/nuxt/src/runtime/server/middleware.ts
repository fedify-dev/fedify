import type { Federation } from "@fedify/fedify/federation";
import { defineEventHandler, type H3Event, toWebRequest } from "h3";
import { DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY } from "./lib.ts";
import { fetchWithFedify } from "./logic.ts";

function assertFederation(
  federation: unknown,
): asserts federation is Federation<unknown> {
  const candidate = federation as { fetch?: unknown } | null | undefined;
  if (candidate == null || typeof candidate.fetch !== "function") {
    throw new TypeError(
      "@fedify/nuxt: Federation instance is missing. " +
        "Export default Federation (or named 'federation') from the configured module.",
    );
  }
}

export function createFedifyMiddleware(
  federation: unknown,
  contextDataFactory?: (event: H3Event, request: Request) => unknown,
) {
  assertFederation(federation);

  return defineEventHandler(async (event) => {
    const request = toWebRequest(event);
    const contextData = typeof contextDataFactory === "function"
      ? await contextDataFactory(event, request)
      : undefined;

    const result = await fetchWithFedify(
      federation.fetch.bind(federation),
      request,
      contextData,
    );

    if (result.kind === "not-found") return;
    if (result.kind === "not-acceptable") {
      event.context[DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY] = true;
      return;
    }

    return result.response;
  });
}
