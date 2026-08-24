import {
  configure,
  getConsoleSink,
  type LogRecord,
  reset,
  type Sink,
} from "@logtape/logtape";
import { createRequire } from "node:module";
import type { TestContext as NodeTestContext } from "node:test";

/** A test callback that uses only APIs supported by every test runtime. */
export type TestFunction = (t: TestContext) => void | Promise<void>;

/** A nested test step supported by Deno, Node.js, Bun, and Workers. */
export interface TestStepDefinition {
  name: string;
  ignore?: boolean;
  fn: TestFunction;
}

/** The common test context supported by every test runtime. */
export interface TestContext {
  readonly name: string;
  readonly origin: string;
  step(definition: TestStepDefinition): Promise<boolean>;
  step(name: string, fn: TestFunction): Promise<boolean>;
  step(fn: TestFunction): Promise<boolean>;
}

/** A test definition supported by every test runtime. */
export interface TestDefinition {
  name: string;
  ignore?: boolean;
  permissions?: Deno.TestDefinition["permissions"];
  sanitizeExit?: Deno.TestDefinition["sanitizeExit"];
  sanitizeOps?: Deno.TestDefinition["sanitizeOps"];
  sanitizeResources?: Deno.TestDefinition["sanitizeResources"];
  fn: TestFunction;
}

type TestOptions = Omit<TestDefinition, "fn" | "name">;

export const testDefinitions: TestDefinition[] = [];

export function test(options: TestDefinition): void;
export function test(
  name: string,
  fn: TestFunction,
): void;
export function test(
  name: string,
  options: TestOptions,
  fn: TestFunction,
): void;
export function test(
  name: string | TestDefinition,
  options?: TestFunction | TestOptions,
  fn?: TestFunction,
): void {
  const def: TestDefinition = typeof name === "string"
    ? typeof options === "function"
      ? { name, fn: options }
      : { name, ...options, fn: fn! }
    : name;
  testDefinitions.push(def);
  if ("Deno" in globalThis) {
    const func = def.fn;
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
          await func(t as TestContext);
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
    function step(def: TestStepDefinition): Promise<boolean>;
    // deno-lint-ignore no-inner-declarations
    function step(
      name: string,
      fn: TestFunction,
    ): Promise<boolean>;
    // deno-lint-ignore no-inner-declarations
    function step(fn: TestFunction): Promise<boolean>;
    // deno-lint-ignore no-inner-declarations
    async function step(
      defOrNameOrFn:
        | TestStepDefinition
        | string
        | TestFunction,
      fn?: TestFunction,
    ): Promise<boolean> {
      let def: TestStepDefinition;
      if (typeof defOrNameOrFn === "string") {
        def = { name: defOrNameOrFn, fn: fn! };
      } else if (typeof defOrNameOrFn === "function") {
        def = { name: defOrNameOrFn.name, fn: defOrNameOrFn };
      } else {
        def = defOrNameOrFn;
      }
      if (def.ignore) return false;
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
    const ctx: TestContext = {
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
    else bunTest(def.name, fn);
  } else if (
    typeof process !== "undefined" &&
    process.release?.name === "node" &&
    !("navigator" in globalThis &&
      navigator.userAgent === "Cloudflare-Workers")
  ) {
    const { test: nodeTest } = createRequire(process.cwd() + "/")("node:test");
    nodeTest(
      def.name,
      { skip: def.ignore },
      async (t: NodeTestContext) => {
        await def.fn(intoTestContext(def.name, t));
      },
    );
  }
}

function intoTestContext(
  name: string,
  ctx: NodeTestContext,
): TestContext {
  function step(def: TestStepDefinition): Promise<boolean>;
  function step(
    name: string,
    fn: TestFunction,
  ): Promise<boolean>;
  function step(fn: TestFunction): Promise<boolean>;
  async function step(
    defOrNameOrFn:
      | TestStepDefinition
      | string
      | TestFunction,
    fn?: TestFunction,
  ): Promise<boolean> {
    let def: TestStepDefinition;
    if (typeof defOrNameOrFn === "string") {
      def = { name: defOrNameOrFn, fn: fn! };
    } else if (typeof defOrNameOrFn === "function") {
      def = { name: defOrNameOrFn.name, fn: defOrNameOrFn };
    } else {
      def = defOrNameOrFn;
    }
    let failed = false;
    await ctx.test(
      def.name,
      { skip: def.ignore },
      async (ctx2) => {
        try {
          await def.fn(intoTestContext(def.name, ctx2));
        } catch (e) {
          failed = true;
          throw e;
        }
      },
    );
    return !def.ignore && !failed;
  }
  const testCtx: TestContext = {
    name,
    origin: ctx.filePath ?? "",
    step,
  };
  return testCtx;
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
