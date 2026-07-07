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

test("CommonJS entries load Temporal-backed modules", {
  ignore: "Deno" in globalThis,
}, () => {
  const originalTemporal = globalThis.Temporal;
  const require = createRequire(import.meta.url);
  const fedify = require("../mod.cjs");
  const federation = require("../federation/mod.cjs");
  const sig = require("../sig/mod.cjs");
  const utils = require("../utils/mod.cjs");

  strictEqual(typeof fedify.createFederation, "function");
  strictEqual(typeof federation.InProcessMessageQueue, "function");
  strictEqual(typeof sig.signRequest, "function");
  strictEqual(typeof utils.kvCache, "function");
  strictEqual(globalThis.Temporal, originalTemporal);
});
