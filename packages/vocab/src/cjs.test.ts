import { ok, rejects, strictEqual } from "node:assert";
import { createRequire } from "node:module";
import { mockDocumentLoader, test } from "@fedify/fixture";

test("CommonJS entry bundles temporal-polyfill internally", {
  ignore: "Deno" in globalThis,
}, async () => {
  const originalTemporal = globalThis.Temporal;

  const require = createRequire(import.meta.url);
  await rejects(
    () => Promise.resolve().then(() => require("temporal-polyfill")),
    (error: unknown) => {
      if (error == null || typeof error !== "object") return false;
      const { code } = error as { code?: unknown };
      return code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
        code === "MODULE_NOT_FOUND";
    },
  );

  const vocab = require("../dist/mod.cjs");
  const obj = await vocab.Object.fromJsonLd({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Object",
    published: "2025-01-01T12:34:56Z",
  }, { documentLoader: mockDocumentLoader, contextLoader: mockDocumentLoader });

  ok(obj.published != null);
  strictEqual(obj.published.toString(), "2025-01-01T12:34:56Z");
  strictEqual(globalThis.Temporal, originalTemporal);
});
