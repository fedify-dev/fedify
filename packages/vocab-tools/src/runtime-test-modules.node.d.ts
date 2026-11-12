// The snapshot test imports Deno's @std/testing and Bun's bun:test only when
// running on those runtimes.  Neither module is available to the Node.js-based
// type check, so these declarations describe the parts that the test uses.
// Deno checks the @std/testing import against its real types, so the
// package's deno.json excludes this file: an ambient declaration would
// otherwise replace them.
declare module "@std/testing/snapshot" {
  export function assertSnapshot(
    context: unknown,
    actual: unknown,
    options?: { path?: string },
  ): Promise<void>;
}

declare module "bun:test" {
  export function test(name: string, fn: () => Promise<void>): void;
  export function expect(actual: unknown): { toMatchSnapshot(): void };
}
