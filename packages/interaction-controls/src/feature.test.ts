import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import {
  FeatureAuthorization,
  FeaturedCollection,
  FeatureRequest,
  InteractionPolicy,
  InteractionRule,
  Person,
  PUBLIC_COLLECTION,
} from "@fedify/vocab";
import { featureInteraction } from "./mod.ts";

const context = {} as Context<void>;
const actor = new URL("https://example.com/users/alice");
const targetId = new URL("https://example.net/users/bob");
const collectionId = new URL("https://example.com/users/alice/featured");
const authorizationId = new URL("https://example.net/authorizations/5");

test("featureInteraction creates and verifies requests", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const request = featureInteraction.createRequest({
    id: new URL("https://example.com/requests/5"),
    actor,
    object: target,
    instrument: collection,
  });

  assert.ok(request instanceof FeatureRequest);

  const result = await featureInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, true);
  assert.equal(result.requester.href, actor.href);
  assert.equal(result.interactingObjectId.href, collectionId.href);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("featureInteraction accepts actorless requests from collection owner", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const request = new FeatureRequest({
    id: new URL("https://example.com/requests/5"),
    object: target,
    instrument: collection,
  });

  const result = await featureInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, true);
  assert.equal(result.requester.href, actor.href);
  assert.equal(result.interactingObjectId.href, collectionId.href);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("featureInteraction denies mismatched collection owners", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: new URL("https://example.org/users/carol"),
  });
  const request = new FeatureRequest({
    id: new URL("https://example.com/requests/5"),
    actor,
    object: target,
    instrument: collection,
  });

  const result = await featureInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "requesterMismatch");
});

test("featureInteraction denies missing canFeature by default", async () => {
  const target = new Person({ id: targetId });

  assert.deepEqual(
    await featureInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "denied",
      reason: { type: "missingPolicy" },
    },
  );
});

test("featureInteraction evaluates canFeature rules", async () => {
  const target = new Person({
    id: targetId,
    interactionPolicy: new InteractionPolicy({
      canFeature: new InteractionRule({ manualApproval: PUBLIC_COLLECTION }),
    }),
  });

  assert.deepEqual(
    await featureInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "manual",
      reason: { type: "public" },
    },
  );
});

test("featureInteraction grants self approval to the featured actor", async () => {
  const target = new Person({ id: targetId });

  assert.deepEqual(
    await featureInteraction.evaluatePolicy(context, {
      subject: target,
      requester: targetId,
    }),
    {
      result: "automatic",
      reason: { type: "self" },
    },
  );
});

test("featureInteraction creates and verifies authorizations", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const authorization = featureInteraction.createAuthorization({
    id: authorizationId,
    attributedTo: targetId,
    interactingObject: collection,
    interactionTarget: target,
  });

  assert.ok(authorization instanceof FeatureAuthorization);

  const result = await featureInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: collection,
    interactionTarget: target,
    attributedTo: targetId,
  });

  assert.equal(result.verified, true);
});

test("featureInteraction verifies actorless authorizations", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const authorization = new FeatureAuthorization({
    id: authorizationId,
    interactingObject: collectionId,
    interactionTarget: targetId,
  });

  const result = await featureInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: collection,
    interactionTarget: target,
    attributedTo: targetId,
  });

  assert.equal(result.verified, true);
});

test("featureInteraction checks actorless authorization origins", async () => {
  const target = new Person({ id: targetId });
  const collection = new FeaturedCollection({
    id: collectionId,
    attribution: actor,
  });
  const authorization = new FeatureAuthorization({
    id: new URL("https://example.org/authorizations/5"),
    interactingObject: collectionId,
    interactionTarget: targetId,
  });

  const result = await featureInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: collection,
    interactionTarget: target,
    attributedTo: targetId,
  });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "originMismatch");
});

test("featureInteraction does not recognize standalone featured items", () => {
  const target = new Person({ id: targetId });

  assert.equal(featureInteraction.recognizeImpolite(target), null);
});
