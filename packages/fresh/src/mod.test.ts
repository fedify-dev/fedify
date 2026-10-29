import type { Federation } from "@fedify/fedify";
import { integrateFetchOptions, integrateHandler } from "@fedify/fresh";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import { ok, strictEqual } from "node:assert/strict";
import type { Context } from "fresh";
import { resetFreshDeprecationWarningForTesting } from "./deprecation.ts";

function createMockContext<TState>(
  overrides: Partial<Context<TState>> = {},
): Context<TState> {
  return {
    req: new Request("https://example.com/"),
    next: () => Promise.resolve(new Response(null, { status: 404 })),
    ...overrides,
  } as Context<TState>;
}

async function configureWarningCapture(records: LogRecord[]): Promise<void> {
  await configure({
    sinks: { capture: (record) => records.push(record) },
    loggers: [
      {
        category: ["fedify", "fresh"],
        lowestLevel: "warning",
        sinks: ["capture"],
      },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });
}

async function captureDeprecationWarnings(
  fn: (records: LogRecord[]) => void | Promise<void>,
): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  await reset();
  resetFreshDeprecationWarningForTesting();
  try {
    await configureWarningCapture(records);
    await fn(records);
    return records;
  } finally {
    await reset();
    resetFreshDeprecationWarningForTesting();
  }
}

Deno.test("deprecation warning - integrateFetchOptions() warns once", async () => {
  const records = await captureDeprecationWarnings(() => {
    integrateFetchOptions(createMockContext());
    integrateFetchOptions(createMockContext());
  });

  strictEqual(records.length, 1);
  strictEqual(records[0].level, "warning");
  const message = records[0].message.join(" ");
  ok(message.includes("@fedify/fresh"));
  ok(message.includes("deprecated"));
  ok(message.includes("1326"));
});

Deno.test("deprecation warning - integrateHandler() warns once", async () => {
  const federation = {
    fetch: () => Promise.resolve(new Response("ok")),
  } as unknown as Federation<void>;

  const records = await captureDeprecationWarnings(async (records) => {
    const handler = integrateHandler(federation, () => undefined);
    strictEqual(records.length, 1);
    await handler(createMockContext());
  });

  strictEqual(records.length, 1);
});

Deno.test("deprecation warning - waits for a warning sink", async () => {
  await reset();
  resetFreshDeprecationWarningForTesting();
  try {
    integrateFetchOptions(createMockContext());

    const records: LogRecord[] = [];
    await configureWarningCapture(records);
    integrateFetchOptions(createMockContext());

    strictEqual(records.length, 1);
  } finally {
    await reset();
    resetFreshDeprecationWarningForTesting();
  }
});

Deno.test("integrateFetchOptions() - onNotFound delegates to ctx.next with correct receiver", async () => {
  const notFoundResponse = new Response("Not Found", { status: 404 });
  let passedRequest: Request | undefined;
  let capturedThis: unknown;

  const mockCtx = {
    next(req?: Request) {
      capturedThis = this;
      passedRequest = req;
      return Promise.resolve(notFoundResponse);
    },
  } as unknown as Context<unknown>;

  const options = integrateFetchOptions(mockCtx);
  const request = new Request("https://example.com/some-page");

  ok((options.onNotFound) != null);
  const response = await options.onNotFound(request);

  strictEqual(capturedThis, mockCtx);
  strictEqual(passedRequest, request);
  strictEqual(response, notFoundResponse);
});

Deno.test("onNotAcceptable() returns Fresh response when not 404", async () => {
  const ctx = createMockContext({
    next: () => Promise.resolve(new Response("ok", { status: 200 })),
  });

  const options = integrateFetchOptions(ctx);
  ok((options.onNotAcceptable) != null);
  const response = await options.onNotAcceptable(ctx.req);

  strictEqual(response.status, 200);
  strictEqual(await response.text(), "ok");
});

Deno.test("onNotAcceptable() returns 406 when Fresh returns 404", async () => {
  const ctx = createMockContext({
    next: () => Promise.resolve(new Response(null, { status: 404 })),
  });

  const options = integrateFetchOptions(ctx);
  ok((options.onNotAcceptable) != null);
  const response = await options.onNotAcceptable(ctx.req);

  strictEqual(response.status, 406);
  strictEqual(response.headers.get("Vary"), "Accept");
  strictEqual(response.headers.get("Content-Type"), "text/plain");
});

Deno.test("integrateHandler() calls createContextData and passes result to federation.fetch()", async () => {
  const expectedContextData = { userId: "test-user" };
  let receivedContextData: unknown;
  let receivedRequest: Request | undefined;

  const mockFederation = {
    fetch: (req: Request, opts: { contextData: unknown }) => {
      receivedRequest = req;
      receivedContextData = opts.contextData;
      return Promise.resolve(new Response("ok"));
    },
  } as unknown as Federation<unknown>;

  const ctx = createMockContext();
  const createContextData = (c: Context<unknown>) => {
    strictEqual(c, ctx);
    return expectedContextData;
  };

  const handler = integrateHandler(mockFederation, createContextData);
  const response = await handler(ctx);

  strictEqual(receivedContextData, expectedContextData);
  strictEqual(receivedRequest, ctx.req);
  strictEqual(await response.text(), "ok");
});

Deno.test("integrateHandler() supports an async createContextData factory", async () => {
  const expectedContextData = { userId: "async-user" };
  let receivedContextData: unknown;

  const mockFederation = {
    fetch: (_req: Request, opts: { contextData: unknown }) => {
      receivedContextData = opts.contextData;
      return Promise.resolve(new Response("ok"));
    },
  } as unknown as Federation<unknown>;

  const createContextData = () => Promise.resolve(expectedContextData);

  const ctx = createMockContext();
  const handler = integrateHandler(mockFederation, createContextData);
  await handler(ctx);

  strictEqual(receivedContextData, expectedContextData);
});
