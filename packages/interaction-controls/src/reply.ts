import {
  Article,
  ChatMessage,
  Create,
  Mention,
  Note,
  Object as ASObject,
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
import type { DereferenceOptions } from "./control.ts";

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
  validateRequest: (_request, reply, target, requester) => {
    const targetId = getRequiredId(target, "interactionTarget");
    if (!idsEqual(reply.replyTargetId, targetId)) {
      return {
        type: "objectMismatch",
        expected: targetId,
        actual: reply.replyTargetId ?? undefined,
      };
    }
    if (!idsEqual(reply.attributionId, requester)) {
      return {
        type: "requesterMismatch",
        expected: requester,
        actual: reply.attributionId ?? undefined,
      };
    }
    return null;
  },
  getSelfActor: (subject) => subject.attributionId,
  getImplicitAutomaticActors: getReplyParticipants,
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

async function* getReplyParticipants(
  subject: ASObject,
  options: DereferenceOptions,
): AsyncIterable<URL> {
  const replyTarget = await subject.getReplyTarget(options);
  if (replyTarget instanceof ASObject && replyTarget.attributionId != null) {
    yield replyTarget.attributionId;
  }
  for await (const tag of subject.getTags(options)) {
    if (tag instanceof Mention && tag.href != null) yield tag.href;
  }
}
