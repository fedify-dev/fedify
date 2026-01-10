import { deepStrictEqual } from "node:assert/strict";
import { mockDocumentLoader } from "./docloader.ts";
import { test } from "./test.ts";

test("mockDocumentLoader()", async () => {
  const response = await mockDocumentLoader("https://example.com/test");
  deepStrictEqual(await response.document, {
    "https://example.com/prop/test": {
      "@value": "foo",
    },
  });
});
