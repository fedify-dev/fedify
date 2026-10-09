import type { App, H3Event } from "h3";
import {
  appendResponseHeader,
  getResponseHeader,
  getResponseStatus,
  removeResponseHeader,
  send,
  setResponseHeader,
  setResponseStatus,
  splitCookiesString,
} from "h3";
import {
  DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY,
  NOT_ACCEPTABLE_BODY,
  RENDERER_CONTEXT_KEY,
} from "./lib.ts";
import { resolveDeferredNotAcceptable } from "./logic.ts";

interface ResponsePayload {
  body?: unknown;
}

interface MinimalNitroApp {
  h3App?: App;
  hooks: {
    hook(
      name: "beforeResponse",
      callback: (event: H3Event, payload: ResponsePayload) => void,
    ): void;
    hook(
      name: "render:before",
      callback: (context: { event: H3Event }) => void,
    ): void;
  };
}

type NitroAppPlugin = (nitroApp: MinimalNitroApp) => void;

function shouldConvert(event: H3Event, status: number): boolean {
  return !event.handled && resolveDeferredNotAcceptable(
        event.context[DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY] === true,
        status,
        event.context.matchedRoute != null &&
          event.context[RENDERER_CONTEXT_KEY] !== true,
      ) != null;
}

function setNotAcceptable(event: H3Event): void {
  for (
    const name of [
      "content-length",
      "content-encoding",
      "content-range",
      "etag",
      "last-modified",
      "content-language",
      "content-location",
    ]
  ) removeResponseHeader(event, name);
  const existing = getResponseHeader(event, "vary");
  const vary = Array.isArray(existing)
    ? existing.join(", ")
    : String(existing ?? "");
  if (
    !vary.split(/,\s*/).some((v) => v === "*" || v.toLowerCase() === "accept")
  ) {
    setResponseHeader(
      event,
      "vary",
      [vary, "Accept"].filter(Boolean).join(", "),
    );
  }
  setResponseHeader(event, "content-type", "text/plain");
  setResponseStatus(event, 406, "Not Acceptable");
}

const fedifyPlugin: NitroAppPlugin = (nitroApp) => {
  nitroApp.hooks.hook("render:before", ({ event }) => {
    event.context[RENDERER_CONTEXT_KEY] = true;
  });
  const options = nitroApp.h3App?.options;
  if (options != null) {
    const onError = options.onError;
    options.onError = async (error, event) => {
      if (!shouldConvert(event, error.statusCode)) {
        return onError?.call(options, error, event);
      }
      setNotAcceptable(event);
      // Nitro's error handler sends directly and bypasses beforeResponse.
      // Await send so H3 sees the event as handled on returning from onError.
      await send(event, NOT_ACCEPTABLE_BODY);
    };
  }
  nitroApp.hooks.hook("beforeResponse", (event, payload) => {
    const body = payload.body;
    const status = body instanceof Response
      ? body.status
      : getResponseStatus(event);
    if (!shouldConvert(event, status)) return;
    if (body instanceof Response) {
      body.headers.forEach((value, name) => {
        if (name === "set-cookie") {
          appendResponseHeader(event, name, splitCookiesString(value));
          return;
        }
        if (name === "vary") {
          const current = getResponseHeader(event, name);
          value = [current, value].filter(Boolean).join(", ");
        }
        setResponseHeader(event, name, value);
      });
      void body.body?.cancel().catch(() => {});
    }
    setNotAcceptable(event);
    payload.body = NOT_ACCEPTABLE_BODY;
  });
};

export default fedifyPlugin;
