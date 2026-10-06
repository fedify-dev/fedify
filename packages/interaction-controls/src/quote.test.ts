import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@fedify/fedify";
import {
  Announce,
  InteractionPolicy,
  InteractionRule,
  Note,
  PUBLIC_COLLECTION,
  QuoteAuthorization,
  QuoteRequest,
} from "@fedify/vocab";
import { type DocumentLoader, preloadedContexts } from "@fedify/vocab-runtime";
import {
  type InteractionRequestVerificationOptions,
  quoteInteraction,
} from "./mod.ts";

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

const elsewhereId = new URL("https://example.net/notes/elsewhere");
const failingDocumentLoader: DocumentLoader = (url) =>
  assert.fail(`must not fetch ${url}`);

function quoteRequest(quote: Note): QuoteRequest {
  return new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: new Note({ id: targetId, attribution: author }),
    instrument: quote,
  });
}

test("quoteInteraction can prefer quote over a conflicting quoteUrl", async () => {
  const request = quoteRequest(
    new Note({
      id: quoteId,
      attribution: actor,
      quote: targetId,
      quoteUrl: elsewhereId,
    }),
  );

  const strict = await quoteInteraction.verifyRequest(context, { request });
  assert.deepEqual(strict.verified ? null : strict.failure, {
    category: "invalid",
    type: "objectMismatch",
    expected: targetId,
    actual: elsewhereId,
  });

  const lenient = await quoteInteraction.verifyRequest(context, {
    request,
    quoteReference: "preferQuote",
  });
  assert.equal(lenient.verified, true);
});

test("quoteInteraction can accept either quote reference", async () => {
  const request = quoteRequest(
    new Note({
      id: quoteId,
      attribution: actor,
      quote: elsewhereId,
      quoteUrl: targetId,
    }),
  );

  const preferQuote = await quoteInteraction.verifyRequest(context, {
    request,
    quoteReference: "preferQuote",
  });
  assert.deepEqual(preferQuote.verified ? null : preferQuote.failure, {
    category: "invalid",
    type: "objectMismatch",
    expected: targetId,
    actual: elsewhereId,
  });

  const any = await quoteInteraction.verifyRequest(context, {
    request,
    quoteReference: "any",
  });
  assert.equal(any.verified, true);

  const neither = await quoteInteraction.verifyRequest(context, {
    request: quoteRequest(
      new Note({
        id: quoteId,
        attribution: actor,
        quote: elsewhereId,
        quoteUrl: new URL("https://example.net/notes/other"),
      }),
    ),
    quoteReference: "any",
  });
  assert.equal(
    neither.verified ? null : neither.failure.type,
    "objectMismatch",
  );
});

test("quoteInteraction can match the requester against any attribution", async () => {
  const request = quoteRequest(
    new Note({
      id: quoteId,
      attributions: [author, actor],
      quote: targetId,
    }),
  );

  const first = await quoteInteraction.verifyRequest(context, { request });
  assert.deepEqual(first.verified ? null : first.failure, {
    category: "unauthorized",
    type: "requesterMismatch",
    expected: actor,
    actual: author,
  });

  const any = await quoteInteraction.verifyRequest(context, {
    request,
    attribution: "any",
  });
  assert.equal(any.verified, true);
});

test("quoteInteraction can treat missing attribution as the requester", async () => {
  const request = quoteRequest(new Note({ id: quoteId, quote: targetId }));

  const strict = await quoteInteraction.verifyRequest(context, { request });
  assert.equal(
    strict.verified ? null : strict.failure.type,
    "requesterMismatch",
  );

  const lenient = await quoteInteraction.verifyRequest(context, {
    request,
    missingAttribution: "requester",
  });
  assert.equal(lenient.verified, true);
  assert.equal(lenient.verified && lenient.requester.href, actor.href);

  const mismatched = await quoteInteraction.verifyRequest(context, {
    request: quoteRequest(
      new Note({ id: quoteId, attribution: author, quote: targetId }),
    ),
    missingAttribution: "requester",
    attribution: "any",
  });
  assert.equal(
    mismatched.verified ? null : mismatched.failure.type,
    "requesterMismatch",
  );
});

test("quoteInteraction treats ID-less attributions as missing without fetching", async () => {
  const quote = await Note.fromJsonLd({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://example.com/contexts/unavailable",
    ],
    type: "Note",
    id: quoteId.href,
    attributedTo: {
      "@context": "https://example.com/contexts/unavailable",
      type: "Person",
      name: "Anonymous",
    },
    quote: targetId.href,
  }, {
    documentLoader: failingDocumentLoader,
    contextLoader: async (url) => {
      await Promise.resolve();
      if (url === "https://example.com/contexts/unavailable") {
        return {
          contextUrl: null,
          documentUrl: url,
          document: {
            "@context": {
              quote: {
                "@id": "https://w3id.org/fep/044f#quote",
                "@type": "@id",
              },
            },
          },
        };
      } else if (url in preloadedContexts) {
        return {
          contextUrl: null,
          documentUrl: url,
          document: preloadedContexts[url],
        };
      }
      return assert.fail(`must not fetch ${url}`);
    },
  });
  const request = quoteRequest(quote);

  const result = await quoteInteraction.verifyRequest(context, {
    request,
    missingAttribution: "requester",
    documentLoader: failingDocumentLoader,
    contextLoader: failingDocumentLoader,
  });

  assert.equal(result.verified, true);
});

test("quoteInteraction verifies requests with resolved objects", async () => {
  const shareId = new URL("https://example.net/shares/1");
  const target = new Note({ id: targetId, attribution: author });
  const quote = new Note({
    id: new URL("https://example.com/notes/redirected"),
    attribution: actor,
    quote: targetId,
  });
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: shareId,
    instrument: quoteId,
  });
  const before = await request.toJsonLd();

  const result = await quoteInteraction.verifyRequest(context, {
    request,
    resolvedInteractionTarget: target,
    resolvedInteractingObject: quote,
    documentLoader: failingDocumentLoader,
  });

  assert.equal(result.verified, true);
  assert.equal(result.verified && result.request, request);
  assert.equal(
    result.verified && result.interactionTargetId.href,
    targetId.href,
  );
  assert.equal(
    result.verified && result.interactingObjectId.href,
    "https://example.com/notes/redirected",
  );
  assert.deepEqual(await request.toJsonLd(), before);
  assert.equal(request.objectId?.href, shareId.href);
  assert.equal(request.instrumentId?.href, quoteId.href);
});

test("quoteInteraction still validates resolved objects", async () => {
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: targetId,
    instrument: quoteId,
  });
  const target = new Note({ id: targetId, attribution: author });
  const before = await request.toJsonLd();

  const wrongType = await quoteInteraction.verifyRequest(context, {
    request,
    resolvedInteractionTarget: target,
    resolvedInteractingObject: new Announce({ id: quoteId, actor }),
    documentLoader: failingDocumentLoader,
  });
  assert.equal(
    wrongType.verified ? null : wrongType.failure.type,
    "wrongInstrumentType",
  );

  const wrongAuthor = await quoteInteraction.verifyRequest(context, {
    request,
    resolvedInteractionTarget: target,
    resolvedInteractingObject: new Note({
      id: quoteId,
      attribution: author,
      quote: targetId,
    }),
    documentLoader: failingDocumentLoader,
  });
  assert.equal(
    wrongAuthor.verified ? null : wrongAuthor.failure.type,
    "requesterMismatch",
  );

  const wrongTarget = await quoteInteraction.verifyRequest(context, {
    request,
    resolvedInteractionTarget: target,
    resolvedInteractingObject: new Note({
      id: quoteId,
      attribution: actor,
      quote: elsewhereId,
    }),
    documentLoader: failingDocumentLoader,
  });
  assert.equal(
    wrongTarget.verified ? null : wrongTarget.failure.type,
    "objectMismatch",
  );
  assert.deepEqual(await request.toJsonLd(), before);
});

test("quoteInteraction does not fill missing request fields with resolved objects", async () => {
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    instrument: quoteId,
  });

  const result = await quoteInteraction.verifyRequest(context, {
    request,
    resolvedInteractionTarget: new Note({ id: targetId, attribution: author }),
    resolvedInteractingObject: new Note({
      id: quoteId,
      attribution: actor,
      quote: targetId,
    }),
    documentLoader: failingDocumentLoader,
  });

  assert.equal(result.verified ? null : result.failure.type, "missingObject");
});

test("quoteInteraction leaves clones taken before verification untouched", async () => {
  const quote = new Note({ id: quoteId, attribution: actor, quote: targetId });
  const request = new QuoteRequest({
    id: new URL("https://example.com/requests/4"),
    actor,
    object: new Note({ id: targetId, attribution: author }),
    instrument: quoteId,
  });
  const original = request.clone();

  const result = await quoteInteraction.verifyRequest(context, {
    request,
    documentLoader: async (url) => ({
      contextUrl: null,
      documentUrl: url,
      document: url in preloadedContexts
        ? preloadedContexts[url]
        : (assert.equal(url, quoteId.href), await quote.toJsonLd()),
    }),
  });

  assert.equal(result.verified, true);
  const json = await original.toJsonLd() as Record<string, unknown>;
  assert.equal(json.instrument, quoteId.href);
});

test("quoteInteraction accepts options typed for older versions", async () => {
  const options: InteractionRequestVerificationOptions<QuoteRequest> = {
    request: quoteRequest(
      new Note({ id: quoteId, attribution: actor, quote: targetId }),
    ),
  };

  const result = await quoteInteraction.verifyRequest(context, options);

  assert.equal(result.verified, true);
});
