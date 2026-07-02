/**
 * Type-checks every workspace member listed in the root *deno.json*.
 *
 * It replaces the previous `deno check $(deno eval ...)` shell substitution,
 * which does not work under Windows `cmd`/`pwsh`, with a portable Deno script
 * that reads the workspace list directly and forwards it to `deno check`.
 */
import $ from "@david/dax";
import deno from "../deno.json" with { type: "json" };

const result = await $`deno check ${deno.workspace}`.noThrow();
Deno.exit(result.code);
