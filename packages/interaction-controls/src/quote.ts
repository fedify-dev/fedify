import {
  Article,
  ChatMessage,
  Create,
  Note,
  type Object as ASObject,
  Question,
  QuoteAuthorization,
  QuoteRequest,
} from "@fedify/vocab";
import {
  createInteractionControl,
  getRequiredId,
  idsEqual,
  recognized,
} from "./control.ts";
import type {
  InteractionControl,
  QuoteRequestValidationOptions,
} from "./types.ts";

export type QuotePost = Note | Article | Question | ChatMessage;

export type QuoteImpoliteSource = Create | QuotePost;

const QUOTE = new URL("https://w3id.org/fep/044f#quote");

function getQuoteTargetId(quote: QuotePost): URL | null {
  return quote.quoteId ?? quote.quoteUrl;
}

export const quoteInteraction: InteractionControl<
  QuoteRequest,
  QuoteAuthorization,
  QuotePost,
  ASObject,
  QuoteImpoliteSource,
  QuoteRequestValidationOptions
> = createInteractionControl({
  name: "quote",
  policyProperty: "canQuote",
  requestClass: QuoteRequest,
  authorizationClass: QuoteAuthorization,
  getInteractingObject: (request, options) =>
    request.getInstrument(options) as Promise<QuotePost | null>,
  isInteractingObject: (object): object is QuotePost =>
    object instanceof Note ||
    object instanceof Article ||
    object instanceof Question ||
    object instanceof ChatMessage,
  interactingObjectTypes: [
    Note.typeId,
    Article.typeId,
    Question.typeId,
    ChatMessage.typeId,
  ],
  getInteractionTarget: (request, options) =>
    request.getObject(options) as Promise<ASObject | null>,
  validateRequest: (
    _request,
    quote,
    target,
    requester,
    options: QuoteRequestValidationOptions,
  ) => {
    const targetId = getRequiredId(target, "interactionTarget");
    const quoteReference = options.quoteReference ?? "strict";
    if (
      quoteReference === "strict" &&
      quote.quoteId != null && quote.quoteUrl != null &&
      !idsEqual(quote.quoteUrl, quote.quoteId)
    ) {
      return {
        type: "objectMismatch",
        expected: quote.quoteId,
        actual: quote.quoteUrl,
      };
    }
    const quoteTargetId = getQuoteTargetId(quote);
    const targetMatched = quoteReference === "any"
      ? idsEqual(quote.quoteId, targetId) || idsEqual(quote.quoteUrl, targetId)
      : idsEqual(quoteTargetId, targetId);
    if (!targetMatched) {
      return {
        type: "objectMismatch",
        expected: targetId,
        actual: quoteTargetId ?? undefined,
      };
    }
    const attributionIds = quote.attributionIds;
    if (
      attributionIds.length < 1 && options.missingAttribution === "requester"
    ) {
      return null;
    }
    const attributionMatched = options.attribution === "any"
      ? attributionIds.some((id) => idsEqual(id, requester))
      : idsEqual(quote.attributionId, requester);
    if (!attributionMatched) {
      return {
        type: "requesterMismatch",
        expected: requester,
        actual: quote.attributionId ?? undefined,
      };
    }
    return null;
  },
  getSelfActor: (subject) => subject.attributionId,
  defaultMissingPolicy: "denied",
  recognizeImpolite: (source) => {
    if (source instanceof Create) return null;
    return recognized({
      requester: source.attributionId,
      interactingObject: source,
      interactionTarget: undefined,
      interactionTargetId: getQuoteTargetId(source),
      source,
      evidence: { type: "property", property: QUOTE },
    });
  },
});
