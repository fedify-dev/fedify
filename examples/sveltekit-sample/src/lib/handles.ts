import type { Handle } from "@sveltejs/kit";
import { getXForwardedRequest } from "x-forwarded-fetch";

/**
 * Replaces the host of the request with the value of the
 * x-forwarded-host header, if present.
 * If you don't use proxy or tunnel, this handle is unnecessary.
 * @param input
 * @return A new request handler with the host replaced.
 */
export const replaceHost: Handle = async ({ event, resolve }) => {
  event.request = await getXForwardedRequest(event.request);
  return resolve(event);
};
