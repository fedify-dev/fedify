import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import {
  Announce,
  AnnounceAuthorization,
  AnnounceRequest,
  InteractionPolicy,
  InteractionRule,
  Note,
  PUBLIC_COLLECTION,
} from "@fedify/vocab";
import { announceInteraction } from "./mod.ts";

const context = {} as Context<void>;
const actor = new URL("https://example.com/users/alice");
const author = new URL("https://example.net/users/bob");
const targetId = new URL("https://example.net/notes/1");
const announceId = new URL("https://example.com/announces/1");
const authorizationId = new URL("https://example.net/authorizations/3");

test("announceInteraction creates and verifies requests", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const announce = new Announce({
    id: announceId,
    actor,
    object: targetId,
  });
  const request = announceInteraction.createRequest({
    id: new URL("https://example.com/requests/3"),
    actor,
    object: target,
    instrument: announce,
  });

  assert.ok(request instanceof AnnounceRequest);

  const result = await announceInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, true);
  assert.equal(result.requester.href, actor.href);
  assert.equal(result.interactingObjectId.href, announceId.href);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("announceInteraction denies mismatched targets", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const announce = new Announce({
    id: announceId,
    actor,
    object: new URL("https://example.net/notes/elsewhere"),
  });
  const request = new AnnounceRequest({
    id: new URL("https://example.com/requests/3"),
    actor,
    object: target,
    instrument: announce,
  });

  const result = await announceInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "objectMismatch");
});

test("announceInteraction denies mismatched requesters", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const announce = new Announce({
    id: announceId,
    actor: new URL("https://example.org/users/carol"),
    object: targetId,
  });
  const request = new AnnounceRequest({
    id: new URL("https://example.com/requests/3"),
    actor,
    object: target,
    instrument: announce,
  });

  const result = await announceInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "requesterMismatch");
});

test("announceInteraction evaluates canAnnounce rules", async () => {
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canAnnounce: new InteractionRule({
        automaticApproval: PUBLIC_COLLECTION,
      }),
    }),
  });

  assert.deepEqual(
    await announceInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "automatic",
      reason: { type: "public" },
    },
  );
});

test("announceInteraction creates and verifies authorizations", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const announce = new Announce({
    id: announceId,
    actor,
    object: targetId,
  });
  const authorization = announceInteraction.createAuthorization({
    id: authorizationId,
    attributedTo: author,
    interactingObject: announce,
    interactionTarget: target,
  });

  assert.ok(authorization instanceof AnnounceAuthorization);

  const result = await announceInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: announce,
    interactionTarget: target,
    attributedTo: author,
  });

  assert.equal(result.verified, true);
});

test("announceInteraction recognizes bare announce activities", () => {
  const announce = new Announce({
    id: announceId,
    actor,
    object: targetId,
  });

  const recognized = announceInteraction.recognizeImpolite(announce);

  assert.ok(recognized);
  assert.equal(recognized.requester.href, actor.href);
  assert.equal(recognized.interactingObjectId.href, announceId.href);
  assert.equal(recognized.interactionTargetId.href, targetId.href);
  assert.equal(recognized.evidence.type, "activity");
});
