import { ok } from "node:assert";

export function assertInstanceOf<T>(
  value: unknown,
  // deno-lint-ignore no-explicit-any
  constructor: new (...args: any[]) => T,
): asserts value is T {
  ok(value instanceof constructor);
}
