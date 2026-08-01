import { test } from "@fedify/fixture";
import { strict as assert } from "node:assert";
import { isFederationRequest } from "./index.ts";

test("Accept header detection", () => {
  const request = new Request("https://example.com/", {
    headers: {
      Accept: "application/activity+json",
    },
  });

  assert.strictEqual(isFederationRequest(request), true);
});
