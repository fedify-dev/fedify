import {
  configure,
  getConsoleSink,
  type LogRecord,
  reset,
  type Sink,
} from "@logtape/logtape";
import type { TestContext } from "node:test";

// Re-export from the new testing package
export { MockContext, MockFederation } from "../../testing/mod.ts";
export type { SentActivity } from "../../testing/mod.ts";
export const testDefinitions: Deno.TestDefinition[] = [];

export function test(options: Deno.TestDefinition): void;
export function test(
  name: string,
  fn: (t: Deno.TestContext) => void | Promise<void>,
): void;
export function test(
  name: string,
  options: Omit<Deno.TestDefinition, "fn" | "name">,
  fn: (t: Deno.TestContext) => void | Promise<void>,
): void;
export function test(
  name: string | Deno.TestDefinition,
  options?:
    | ((
      t: Deno.TestContext,
    ) => void | Promise<void>)
    | Omit<Deno.TestDefinition, "fn" | "name">,
  fn?: (t: Deno.TestContext) => void | Promise<void>,
): void {
  const def: Deno.TestDefinition = typeof name === "string"
    ? typeof options === "function"
      ? { name, fn: options }
      : { name, ...options, fn: fn! }
    : (name satisfies Deno.TestDefinition);
  testDefinitions.push(def);
  if ("Deno" in globalThis) {
    const func: (t: Deno.TestContext) => void | Promise<void> = def.fn;
    Deno.test({
      ...def,
      async fn(t: Deno.TestContext) {
        const records: LogRecord[] = [];
        await configure({
          sinks: {
            buffer(record: LogRecord): void {
              if (
                record.category.length > 1 &&
                record.category[0] === "logtape" &&
                record.category[1] === "meta"
              ) return;
              records.push(record);
            },
            console: getConsoleSink(),
          },
          filters: {},
          loggers: [
            {
              category: [],
              sinks: [Deno.env.get("LOG") === "always" ? "console" : "buffer"],
            },
          ],
        });
        try {
          await func(t);
        } catch (e) {
          const consoleSink: Sink = getConsoleSink();
          for (const record of records) consoleSink(record);
          throw e;
        } finally {
          await reset();
        }
      },
    });
  } else if ("Bun" in globalThis) {
    let failed: unknown = undefined;
    // deno-lint-ignore no-inner-declarations
    function step(def: Deno.TestStepDefinition): Promise<boolean>;
    // deno-lint-ignore no-inner-declarations
    function step(
      name: string,
      fn: (ctx: Deno.TestContext) => void | Promise<void>,
    ): Promise<boolean>;
    // deno-lint-ignore no-inner-declarations
    function step(
      fn: (ctx: Deno.TestContext) => void | Promise<void>,
    ): Promise<boolean>;
    // deno-lint-ignore no-inner-declarations
    async function step(
      defOrNameOrFn:
        | Deno.TestStepDefinition
        | string
        | ((ctx: Deno.TestContext) => void | Promise<void>),
      fn?: (ctx: Deno.TestContext) => void | Promise<void>,
    ): Promise<boolean> {
      let def: Deno.TestStepDefinition;
      if (typeof defOrNameOrFn === "string") {
        def = { name: defOrNameOrFn, fn: fn! };
      } else if (typeof defOrNameOrFn === "function") {
        def = { name: defOrNameOrFn.name, fn: defOrNameOrFn };
      } else {
        def = defOrNameOrFn;
      }
      if (def.ignore) return true;
      try {
        await def.fn({
          name: def.name,
          origin: "",
          step,
        });
      } catch (e) {
        failed ??= e;
        return false;
      }
      return true;
    }
    const ctx: Deno.TestContext = {
      name: def.name,
      origin: "",
      step,
    };
    // deno-lint-ignore no-inner-declarations
    async function fn() {
      await def.fn(ctx);
      if (failed) throw failed;
    }
    // @ts-ignore: Bun exists in the global scope in Bun
    const bunTest = Bun.jest(caller()).test;
    if (def.ignore) bunTest.skip(def.name, fn);
    else if (def.only) bunTest.only(def.name, fn);
    else bunTest(def.name, fn);
  } else {
    try {
      const { test: nodeTest } = require("node:test");
      nodeTest(
        def.name,
        { only: def.only, skip: def.ignore },
        async (t: TestContext) => {
          await def.fn(intoDenoTestContext(def.name, t));
        },
      );
    } catch {
      // Fallback for environments without `node:test`
    }
  }
}

function intoDenoTestContext(
  name: string,
  ctx: TestContext,
): Deno.TestContext {
  function step(def: Deno.TestStepDefinition): Promise<boolean>;
  function step(
    name: string,
    fn: (ctx: Deno.TestContext) => void | Promise<void>,
  ): Promise<boolean>;
  function step(
    fn: (ctx: Deno.TestContext) => void | Promise<void>,
  ): Promise<boolean>;
  async function step(
    defOrNameOrFn:
      | Deno.TestStepDefinition
      | string
      | ((ctx: Deno.TestContext) => void | Promise<void>),
    fn?: (ctx: Deno.TestContext) => void | Promise<void>,
  ): Promise<boolean> {
    let def: Deno.TestStepDefinition;
    if (typeof defOrNameOrFn === "string") {
      def = { name: defOrNameOrFn, fn: fn! };
    } else if (typeof defOrNameOrFn === "function") {
      def = { name: defOrNameOrFn.name, fn: defOrNameOrFn };
    } else {
      def = defOrNameOrFn;
    }
    let failed = false;
    await ctx.test(def.name, async (ctx2) => {
      try {
        await def.fn(intoDenoTestContext(def.name, ctx2));
      } catch (e) {
        failed = true;
        throw e;
      }
    });
    return failed;
  }
  const denoCtx: Deno.TestContext = {
    name,
    origin: ctx.filePath ?? "",
    step,
  };
  return denoCtx;
}

// Below code is borrowed from https://github.com/oven-sh/bun/issues/11660#issuecomment-2506832106

/** Retrieve caller test file. */
function caller() {
  const Trace = Error as unknown as {
    prepareStackTrace: (error: Error, stack: CallSite[]) => unknown;
  };
  const _ = Trace.prepareStackTrace;
  Trace.prepareStackTrace = (_, stack) => stack;
  const { stack } = new Error();
  Trace.prepareStackTrace = _;
  const caller = (stack as unknown as CallSite[])[2];
  return caller.getFileName().replaceAll("\\", "/");
}

/** V8 CallSite (subset). */
type CallSite = { getFileName: () => string };
