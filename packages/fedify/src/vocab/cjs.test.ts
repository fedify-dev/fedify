import { strictEqual } from "node:assert";
import { createRequire } from "node:module";
import { test } from "@fedify/fixture";

test(
  "CommonJS vocab entry exports Object",
  {
    ignore:
      "Deno" in globalThis ||
      ("navigator" in globalThis &&
        navigator.userAgent === "Cloudflare-Workers"),
  },
  () => {
    const require = createRequire(import.meta.url);
    const vocab = require("@fedify/fedify/vocab");
    strictEqual(typeof vocab.Object, "function");
    strictEqual(typeof vocab.Update, "function");
  },
);

test(
  "CommonJS entries load Temporal-backed modules",
  {
    ignore: "Deno" in globalThis,
  },
  () => {
    const originalTemporal = globalThis.Temporal;
    const require = createRequire(import.meta.url);
    const fedify = require("@fedify/fedify");
    const federation = require("@fedify/fedify/federation");
    const sig = require("@fedify/fedify/sig");
    const utils = require("@fedify/fedify/utils");

    strictEqual(typeof fedify.createFederation, "function");
    strictEqual(typeof federation.InProcessMessageQueue, "function");
    strictEqual(typeof sig.signRequest, "function");
    strictEqual(typeof utils.kvCache, "function");
    strictEqual(globalThis.Temporal, originalTemporal);
  },
);
