import {
  Article,
  ChatMessage,
  Create,
  Note,
  type Object as ASObject,
  Question,
  ReplyAuthorization,
  ReplyRequest,
} from "@fedify/vocab";
import {
  createInteractionControl,
  getRequiredId,
  idsEqual,
  recognized,
} from "./control.ts";
import type { InteractionControl } from "./types.ts";

export type ReplyPost = Note | Article | Question | ChatMessage;

export type ReplyImpoliteSource = Create | ReplyPost;

const IN_REPLY_TO = new URL("https://www.w3.org/ns/activitystreams#inReplyTo");

export const replyInteraction: InteractionControl<
  ReplyRequest,
  ReplyAuthorization,
  ReplyPost,
  ASObject,
  ReplyImpoliteSource
> = createInteractionControl({
  name: "reply",
  policyProperty: "canReply",
  requestClass: ReplyRequest,
  authorizationClass: ReplyAuthorization,
  getInteractingObject: (request, options) =>
    request.getInstrument(options) as Promise<ReplyPost | null>,
  isInteractingObject: (object): object is ReplyPost =>
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
  validateRequest: (request, reply, target) => {
    const targetId = getRequiredId(target, "interactionTarget");
    if (!idsEqual(reply.replyTargetId, targetId)) {
      return {
        type: "objectMismatch",
        expected: targetId,
        actual: reply.replyTargetId ?? undefined,
      };
    }
    if (
      !idsEqual(reply.attributionId, request.actorId ?? new URL("about:blank"))
    ) {
      return {
        type: "requesterMismatch",
        expected: request.actorId ?? new URL("about:blank"),
        actual: reply.attributionId ?? undefined,
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
      interactionTargetId: source.replyTargetId,
      source,
      evidence: { type: "property", property: IN_REPLY_TO },
    });
  },
});
