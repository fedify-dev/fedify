import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  InteractionAuthorizationVerificationFailure,
  InteractionKey,
  InteractionPolicyDecision,
  InteractionRequestCreationOptions,
} from "./mod.ts";
import type { Object as ASObject } from "@fedify/vocab";

test("public types expose readonly fields", () => {
  const key: InteractionKey = {
    interaction: "quote",
    requester: new URL("https://example.com/actors/1"),
    interactingObjectId: new URL("https://example.com/objects/1"),
    interactionTargetId: new URL("https://example.net/objects/1"),
  };

  // @ts-expect-error Interaction keys are immutable.
  key.requester = new URL("https://example.com/actors/2");

  const requestOptions: InteractionRequestCreationOptions<ASObject, ASObject> =
    {
      id: new URL("https://example.com/requests/1"),
      actor: new URL("https://example.com/actors/1"),
      object: new URL("https://example.net/objects/1"),
      instrument: new URL("https://example.com/objects/1"),
      to: [new URL("https://example.net/actors/1")],
    };

  // @ts-expect-error Option arrays are immutable.
  requestOptions.to?.push(new URL("https://example.net/actors/2"));

  const decision: InteractionPolicyDecision = {
    result: "automatic",
    reason: { type: "default", default: "publicAutomatic" },
  };

  // @ts-expect-error Policy decisions are immutable.
  decision.result = "denied";

  const failure: InteractionAuthorizationVerificationFailure = {
    category: "unauthorized",
    type: "wrongType",
    expectedType: new URL("https://example.com/Expected"),
    actualTypes: [new URL("https://example.com/Actual")],
  };

  // @ts-expect-error Failure arrays are immutable.
  failure.actualTypes.push(new URL("https://example.com/Other"));

  assert.equal(key.interaction, "quote");
});
