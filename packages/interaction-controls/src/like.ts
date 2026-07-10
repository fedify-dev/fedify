import {
  Like,
  LikeAuthorization,
  LikeRequest,
  type Object as ASObject,
} from "@fedify/vocab";
import {
  createInteractionControl,
  getRequiredId,
  idsEqual,
  recognized,
} from "./control.ts";
import type { InteractionControl } from "./types.ts";

export const likeInteraction: InteractionControl<
  LikeRequest,
  LikeAuthorization,
  Like,
  ASObject,
  Like
> = createInteractionControl({
  name: "like",
  policyProperty: "canLike",
  requestClass: LikeRequest,
  authorizationClass: LikeAuthorization,
  getInteractingObject: (request, options) =>
    request.getInstrument(options) as Promise<Like | null>,
  isInteractingObject: (object): object is Like => object instanceof Like,
  interactingObjectTypes: [Like.typeId],
  getInteractionTarget: (request, options) =>
    request.getObject(options) as Promise<ASObject | null>,
  validateRequest: (_request, like, target, requester) => {
    const targetId = getRequiredId(target, "interactionTarget");
    if (!idsEqual(like.objectId, targetId)) {
      return {
        type: "objectMismatch",
        expected: targetId,
        actual: like.objectId ?? undefined,
      };
    }
    if (!idsEqual(like.actorId, requester)) {
      return {
        type: "requesterMismatch",
        expected: requester,
        actual: like.actorId ?? undefined,
      };
    }
    return null;
  },
  getSelfActor: (subject) => subject.attributionId,
  defaultMissingPolicy: "automatic",
  recognizeImpolite: (source) =>
    recognized({
      requester: source.actorId,
      interactingObject: source,
      interactionTarget: undefined,
      interactionTargetId: source.objectId,
      source,
      evidence: { type: "activity", activityType: Like.typeId },
    }),
});
