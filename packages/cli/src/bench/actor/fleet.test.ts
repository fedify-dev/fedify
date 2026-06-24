import assert from "node:assert/strict";
import test from "node:test";
import { buildFleet } from "./fleet.ts";

test("buildFleet - rejects a group with two HTTP signature standards", async () => {
  await assert.rejects(
    buildFleet([{
      signatureStandards: ["draft-cavage-http-signatures-12", "rfc9421"],
    }]),
    TypeError,
  );
});

test("buildFleet - rejects a group with no HTTP signature standard", async () => {
  await assert.rejects(
    buildFleet([{ signatureStandards: ["ld-signatures"] }]),
    TypeError,
  );
});
