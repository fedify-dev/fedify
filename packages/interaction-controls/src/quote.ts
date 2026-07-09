import {
  type Article,
  type ChatMessage,
  Create,
  type Note,
  type Object as ASObject,
  type Question,
  QuoteAuthorization,
  QuoteRequest,
} from "@fedify/vocab";
import {
  createInteractionControl,
  getRequiredId,
  idsEqual,
  recognized,
} from "./control.ts";
import type { InteractionControl } from "./types.ts";

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
  QuoteImpoliteSource
> = createInteractionControl({
  name: "quote",
  policyProperty: "canQuote",
  requestClass: QuoteRequest,
  authorizationClass: QuoteAuthorization,
  getInteractingObject: (request, options) =>
    request.getInstrument(options) as Promise<QuotePost | null>,
  getInteractionTarget: (request, options) =>
    request.getObject(options) as Promise<ASObject | null>,
  validateRequest: (request, quote, target) => {
    const targetId = getRequiredId(target, "interactionTarget");
    const quoteTargetId = getQuoteTargetId(quote);
    if (!idsEqual(quoteTargetId, targetId)) {
      return {
        type: "objectMismatch",
        expected: targetId,
        actual: quoteTargetId ?? undefined,
      };
    }
    if (
      !idsEqual(quote.attributionId, request.actorId ?? new URL("about:blank"))
    ) {
      return {
        type: "requesterMismatch",
        expected: request.actorId ?? new URL("about:blank"),
        actual: quote.attributionId ?? undefined,
      };
    }
    return null;
  },
  getSelfActor: (subject) => subject.attributionId,
  defaultMissingPolicy: "automatic",
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
