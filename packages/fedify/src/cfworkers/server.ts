import {
  ansiColorFormatter,
  configure,
  type LogRecord,
} from "@logtape/logtape";
import { AsyncLocalStorage } from "node:async_hooks";
// @ts-ignore: The following code is generated
import { testDefinitions } from "./dist/testing/mod.js";
// @ts-ignore: The following code is generated
import "./imports.ts";

interface TestDefinition {
  name: string;
  ignore?: boolean;
  fn: (
    // deno-lint-ignore no-explicit-any
    ctx: { name: string; origin: string; step: any },
  ) => void | Promise<void>;
}

// @ts-ignore: testDefinitions is untyped
const tests: TestDefinition[] = testDefinitions;
const logs: LogRecord[] = [];
const messageBatches: MessageBatch[] = [];

await configure({
  sinks: {
    buffer: logs.push.bind(logs),
  },
  loggers: [
    { category: [], sinks: ["buffer"], lowestLevel: "debug" },
  ],
  contextLocalStorage: new AsyncLocalStorage(),
});

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    if (request.method === "GET") {
      return new Response(
        JSON.stringify(tests.map(({ name }) => name)),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const testName = await request.text();
    for (const def of tests) {
      const { name, fn, ignore } = def;
      if (testName !== name) continue;
      if (ignore) {
        return new Response(
          "",
          {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          },
        );
      }
      let failed: unknown = undefined;
      let capturedLogs: LogRecord[] | undefined = undefined;
      // deno-lint-ignore no-inner-declarations
      async function step(
        arg: string | {
          name: string;
          ignore?: boolean;
          // deno-lint-ignore no-explicit-any
          fn: (def: any) => void | Promise<void>;
          // deno-lint-ignore no-explicit-any
        } | ((ctx: any) => void | Promise<void>),
        // deno-lint-ignore no-explicit-any
        fn?: (ctx: any) => void | Promise<void>,
      ) {
        let def: {
          name: string;
          ignore?: boolean;
          // deno-lint-ignore no-explicit-any
          fn: (def: any) => void | Promise<void>;
        };
        if (typeof arg === "string") {
          def = { name: arg, fn: fn! };
        } else if (typeof arg === "function") {
          def = { name: arg.name, fn: arg };
        } else {
          def = arg;
        }
        if (def.ignore) return;
        try {
          await def.fn({
            name: def.name,
            origin: "",
            step,
          });
        } catch (e) {
          failed ??= e;
          capturedLogs ??= [...logs];
          return false;
        }
        return true;
      }
      logs.splice(0, logs.length); // Clear logs
      try {
        await fn({ name, origin: "", step, env, messageBatches });
      } catch (e) {
        failed ??= e;
      }
      capturedLogs ??= [...logs];
      if (typeof failed === "undefined") {
        return new Response(
          "",
          { status: 200, headers: { "Content-Type": "text/plain" } },
        );
      } else {
        return new Response(
          `${
            failed instanceof Error
              ? `${failed.message}\n${failed.stack ?? ""}`
              : String(failed)
          }\n${capturedLogs.map(ansiColorFormatter).join("")}`,
          {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          },
        );
      }
    }
    return new Response(
      "Test not found",
      {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      },
    );
  },
  async queue(
    batch: MessageBatch,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<void> {
    messageBatches.push(batch);
  },
};
