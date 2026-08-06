import type { Federation } from "@fedify/fedify";
import type {
  NextFunction,
  Request as ERequest,
  Response as EResponse,
} from "express";
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { integrateFederation } from "./index.ts";

test("integrateFederation delegates not-found requests to Express", async () => {
  let nextCalls = 0;
  const federation = {
    fetch: (
      _request: Request,
      options: { onNotFound: () => Response },
    ) => {
      options.onNotFound();
      return new Response("unused", { status: 404 });
    },
  } as unknown as Federation<void>;

  const request = {
    protocol: "https",
    host: "example.com",
    url: "/not-a-federation-route",
    method: "GET",
    headers: {},
  } as ERequest;
  const response = {} as EResponse;
  const next: NextFunction = () => {
    nextCalls++;
  };

  const middleware = integrateFederation(federation, () => undefined);
  middleware(request, response, next);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(nextCalls, 1);
});
