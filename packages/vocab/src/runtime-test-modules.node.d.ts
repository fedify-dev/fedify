// The Deno.inspect() snapshot tests import Deno's @std/testing only when
// running on Deno.  The module is not available to the Node.js-based type
// check, so this declaration describes the part that the tests use.  Deno
// checks the import against its real types, so the package's deno.json
// excludes this file: an ambient declaration would otherwise replace them.
declare module "@std/testing/snapshot" {
  export function assertSnapshot(
    context: unknown,
    actual: unknown,
  ): Promise<void>;
}
