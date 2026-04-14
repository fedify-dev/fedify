import type { H3Event } from "h3";
import { getResponseStatus, setResponseHeader, setResponseStatus } from "h3";
import {
  DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY,
  NOT_ACCEPTABLE_BODY,
} from "./lib.ts";
import { resolveDeferredNotAcceptable } from "./logic.ts";

interface ResponsePayload {
  body?: unknown;
}

interface MinimalNitroApp {
  hooks: {
    hook(
      name: "beforeResponse",
      callback: (event: H3Event, payload: ResponsePayload) => void,
    ): void;
  };
}

type NitroAppPlugin = (nitroApp: MinimalNitroApp) => void;

const fedifyPlugin: NitroAppPlugin = (nitroApp: MinimalNitroApp) => {
  nitroApp.hooks.hook(
    "beforeResponse",
    (event: H3Event, payload: ResponsePayload) => {
      const deferred =
        event.context[DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY] === true;
      delete event.context[DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY];

      const negotiatedResponse = resolveDeferredNotAcceptable(
        deferred,
        getResponseStatus(event),
        event.context.matchedRoute != null,
      );
      if (negotiatedResponse == null) return;

      setResponseStatus(event, negotiatedResponse.status);
      negotiatedResponse.headers.forEach((value: string, key: string) => {
        setResponseHeader(event, key, value);
      });

      payload.body = NOT_ACCEPTABLE_BODY;
    },
  );
};

export default fedifyPlugin;
