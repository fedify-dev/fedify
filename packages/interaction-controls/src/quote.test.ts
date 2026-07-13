import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import {
  InteractionPolicy,
  InteractionRule,
  Note,
  PUBLIC_COLLECTION,
  QuoteAuthorization,
  QuoteRequest,
} from "@fedify/vocab";
import { quoteInteraction } from "./mod.ts";

const context = {} as Context<void>;
const actor = new URL("https://example.com/users/alice");
const author = new URL("https://example.net/users/bob");
const targetId = new URL("https://example.net/notes/1");
const quoteId = new URL("https://example.com/notes/3");
const authorizationId = new URL("https://example.net/authorizations/4");
const verifyAuthenticity = () => true;

test("quoteInteraction creates and verifies requests", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const quote = new Note({
    id: quoteId,
    attribution: actor,
    quote: targetId,
  });
  const request = quoteInteraction.createRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: target,
    instrument: quote,
  });

  assert.ok(request instanceof QuoteRequest);

  const result = await quoteInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, true);
  assert.equal(result.requester.href, actor.href);
  assert.equal(result.interactingObjectId.href, quoteId.href);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("quoteInteraction accepts compatible quoteUrl targets", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const quote = new Note({
    id: quoteId,
    attribution: actor,
    quoteUrl: targetId,
  });
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: target,
    instrument: quote,
  });

  const result = await quoteInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, true);
  assert.equal(result.interactionTargetId.href, targetId.href);
});

test("quoteInteraction denies mismatched targets", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const quote = new Note({
    id: quoteId,
    attribution: actor,
    quote: new URL("https://example.net/notes/elsewhere"),
  });
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: target,
    instrument: quote,
  });

  const result = await quoteInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "objectMismatch");
});

test("quoteInteraction denies conflicting quote target fields", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const quote = new Note({
    id: quoteId,
    attribution: actor,
    quote: targetId,
    quoteUrl: new URL("https://example.net/notes/elsewhere"),
  });
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: target,
    instrument: quote,
  });

  const result = await quoteInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "objectMismatch");
});

test("quoteInteraction denies mismatched requesters", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const quote = new Note({
    id: quoteId,
    attribution: new URL("https://example.org/users/carol"),
    quote: targetId,
  });
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: target,
    instrument: quote,
  });

  const result = await quoteInteraction.verifyRequest(context, { request });

  assert.equal(result.verified, false);
  assert.equal(result.failure.type, "requesterMismatch");
});

test("quoteInteraction evaluates canQuote rules", async () => {
  const target = new Note({
    id: targetId,
    attribution: author,
    interactionPolicy: new InteractionPolicy({
      canQuote: new InteractionRule({ manualApproval: PUBLIC_COLLECTION }),
    }),
  });

  assert.deepEqual(
    await quoteInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "manual",
      reason: { type: "public" },
    },
  );
});

test("quoteInteraction denies missing canQuote by default", async () => {
  const target = new Note({ id: targetId, attribution: author });

  assert.deepEqual(
    await quoteInteraction.evaluatePolicy(context, {
      subject: target,
      requester: actor,
    }),
    {
      result: "denied",
      reason: { type: "missingPolicy" },
    },
  );
});

test("quoteInteraction creates and verifies authorizations", async () => {
  const target = new Note({ id: targetId, attribution: author });
  const quote = new Note({
    id: quoteId,
    attribution: actor,
    quote: targetId,
  });
  const authorization = quoteInteraction.createAuthorization({
    id: authorizationId,
    attributedTo: author,
    interactingObject: quote,
    interactionTarget: target,
  });

  assert.ok(authorization instanceof QuoteAuthorization);

  const result = await quoteInteraction.verifyAuthorization(context, {
    authorization,
    interactingObject: quote,
    interactionTarget: target,
    attributedTo: author,
    verifyAuthenticity,
  });

  assert.equal(result.verified, true);
});

test("quoteInteraction recognizes bare quote objects", () => {
  const quote = new Note({
    id: quoteId,
    attribution: actor,
    quote: targetId,
  });

  const recognized = quoteInteraction.recognizeImpolite(quote);

  assert.ok(recognized);
  assert.equal(recognized.requester.href, actor.href);
  assert.equal(recognized.interactingObjectId.href, quoteId.href);
  assert.equal(recognized.interactionTargetId.href, targetId.href);
  assert.equal(recognized.evidence.type, "property");
});
