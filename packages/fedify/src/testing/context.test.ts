import { strictEqual } from "node:assert/strict";
import { test } from "@fedify/fixture";

test("ignored nested test steps return false", async (t) => {
  let executed = false;
  const result = await t.step({
    name: "ignored nested test step",
    ignore: true,
    fn() {
      executed = true;
    },
  });

  strictEqual(result, false);
  strictEqual(executed, false);
});
