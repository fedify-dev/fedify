import { test } from "@fedify/fixture";
import type { H3Event } from "h3";
import { equal, ok } from "node:assert/strict";
import {
  DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY,
  NOT_ACCEPTABLE_BODY,
} from "./lib.ts";
import fedifyPlugin from "./plugin.ts";

interface MockResponse {
  statusCode: number;
  statusMessage?: string;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
}

function createMockResponse(statusCode: number): MockResponse {
  const headers = new Map<string, string>();
  return {
    statusCode,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
}

function registerBeforeResponseHook() {
  let callback:
    | ((event: H3Event, payload: { body?: unknown }) => void)
    | undefined;

  fedifyPlugin({
    hooks: {
      hook(name, registeredCallback) {
        equal(name, "beforeResponse");
        callback = registeredCallback;
      },
    },
  });

  ok(callback, "beforeResponse hook should be registered");
  return callback;
}

test(
  "plugin rewrites deferred 404 without matched route to 406",
  () => {
    const beforeResponse = registerBeforeResponseHook();
    const response = createMockResponse(404);
    const payload = { body: "original body" };
    const event = {
      context: {
        [DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY]: true,
      },
      node: { res: response },
    };

    beforeResponse(event as unknown as H3Event, payload);

    equal(response.statusCode, 406);
    equal(response.getHeader("content-type"), "text/plain");
    equal(response.getHeader("vary"), "Accept");
    equal(payload.body, NOT_ACCEPTABLE_BODY);
    equal(
      event.context[DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY],
      undefined,
    );
  },
);

test(
  "plugin ignores 404 when deferred flag is absent",
  () => {
    const beforeResponse = registerBeforeResponseHook();
    const response = createMockResponse(404);
    const payload = { body: "regular 404" };
    const event: H3Event = {
      context: {},
      node: { res: response },
    } as unknown as H3Event;

    beforeResponse(event, payload);

    equal(response.statusCode, 404);
    equal(response.getHeader("content-type"), undefined);
    equal(payload.body, "regular 404");
  },
);

test(
  "plugin preserves shared-route 404 when Nuxt matched the route",
  () => {
    const beforeResponse = registerBeforeResponseHook();
    const response = createMockResponse(404);
    const payload = { body: "missing actor page" };
    const event = {
      context: {
        [DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY]: true,
        matchedRoute: {},
      },
      node: { res: response },
    };

    beforeResponse(event as unknown as H3Event, payload);

    equal(response.statusCode, 404);
    equal(response.getHeader("content-type"), undefined);
    equal(response.getHeader("vary"), undefined);
    equal(payload.body, "missing actor page");
    equal(
      event.context[DEFERRED_NOT_ACCEPTABLE_CONTEXT_KEY],
      undefined,
    );
  },
);
