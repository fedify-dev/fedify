import type { FederationFetchOptions } from "@fedify/fedify/federation";
import { NOT_ACCEPTABLE_BODY } from "./lib.ts";

export { DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY } from "./lib.ts";

const DUMMY_NOT_FOUND_RESPONSE = new Response("", { status: 404 });

const createNotAcceptableResponse = () =>
  new Response(NOT_ACCEPTABLE_BODY, {
    status: 406,
    headers: {
      "Content-Type": "text/plain",
      Vary: "Accept",
    },
  });

export type FetchResult =
  | { kind: "handled"; response: Response }
  | { kind: "not-found" }
  | { kind: "not-acceptable" };

export async function fetchWithFedify(
  fetcher: (
    request: Request,
    options: FederationFetchOptions<unknown>,
  ) => Promise<Response>,
  request: Request,
  contextData: unknown,
): Promise<FetchResult> {
  const response = await fetcher(request, {
    contextData,
    onNotFound: () => DUMMY_NOT_FOUND_RESPONSE,
    onNotAcceptable: createNotAcceptableResponse,
  });

  if (response === DUMMY_NOT_FOUND_RESPONSE) {
    return { kind: "not-found" };
  }

  if (response.status === 406) {
    return { kind: "not-acceptable" };
  }

  return { kind: "handled", response };
}

export function resolveDeferredNotAcceptable(
  isDeferred: boolean,
  frameworkStatus: number,
): Response | undefined {
  if (!isDeferred || frameworkStatus !== 404) return undefined;
  return createNotAcceptableResponse();
}
