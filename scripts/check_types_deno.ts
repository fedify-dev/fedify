/**
 * Type-checks the Deno workspace with `deno check`, as a Deno compatibility
 * check.  The default type check, *scripts/check\_types.ts*, runs TypeScript
 * on Node.js instead.
 *
 * It passes every workspace member listed in the root *deno.json*, plus the
 * Deno entry points outside the workspace listed in
 * *scripts/check\_types\_ownership.ts*, to `deno check`.  Reading the list
 * here rather than in a shell substitution keeps it portable to Windows.
 */
import $ from "@david/dax";
import deno from "../deno.json" with { type: "json" };
import { DENO_EXTRA_ENTRY_POINTS } from "./check_types_ownership.ts";

const result = await $`deno --quiet check ${deno.workspace} ${[
  ...DENO_EXTRA_ENTRY_POINTS,
]}`
  .cwd(new URL("../", import.meta.url))
  .noThrow();
Deno.exit(result.code);
