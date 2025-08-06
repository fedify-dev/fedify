import { assertEquals } from "@std/assert";
import { mockDocumentLoader } from "./docloader.ts";
import { test } from "./mod.ts";

test("mockDocumentLoader()", async () => {
  const response = await mockDocumentLoader("https://example.com/test");
  assertEquals(await response.document, {
    "https://example.com/prop/test": {
      "@value": "foo",
    },
  });
});
