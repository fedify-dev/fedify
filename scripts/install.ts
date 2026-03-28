import $ from "@david/dax";
import { dirname, join } from "@std/path";
import deno from "../deno.json" with { type: "json" };

const root = dirname(import.meta.dirname ?? ".");
const { workspace } = deno;

const files: string[] = [];
for (const member of workspace) {
  const memberDir = join(root, member);
  const memberDeno = JSON.parse(
    await Deno.readTextFile(join(memberDir, "deno.json")),
  );
  if (!("exports" in memberDeno)) continue;
  const exports: string | Record<string, string> = memberDeno.exports;
  if (typeof exports === "string") files.push(join(memberDir, exports));
  else {
    for (const key in exports) files.push(join(memberDir, exports[key]));
  }
}

await $`deno cache ${files}`;
