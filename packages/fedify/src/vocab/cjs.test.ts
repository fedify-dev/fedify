import { strictEqual } from "node:assert";
import { createRequire } from "node:module";
import { test } from "@fedify/fixture";

test("CommonJS vocab entry exports Object", {
  ignore: "Deno" in globalThis,
}, () => {
  const require = createRequire(import.meta.url);
  const vocab = require("./mod.cjs");
  strictEqual(typeof vocab.Object, "function");
  strictEqual(typeof vocab.Update, "function");
});
