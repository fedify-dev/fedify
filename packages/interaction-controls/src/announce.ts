import {
  Announce,
  AnnounceAuthorization,
  AnnounceRequest,
  type Object as ASObject,
} from "@fedify/vocab";
import {
  createInteractionControl,
  getRequiredId,
  idsEqual,
  recognized,
} from "./control.ts";
import type { InteractionControl } from "./types.ts";

export const announceInteraction: InteractionControl<
  AnnounceRequest,
  AnnounceAuthorization,
  Announce,
  ASObject,
  Announce
> = createInteractionControl({
  name: "announce",
  policyProperty: "canAnnounce",
  requestClass: AnnounceRequest,
  authorizationClass: AnnounceAuthorization,
  getInteractingObject: (request, options) =>
    request.getInstrument(options) as Promise<Announce | null>,
  getInteractionTarget: (request, options) =>
    request.getObject(options) as Promise<ASObject | null>,
  validateRequest: (request, announce, target) => {
    const targetId = getRequiredId(target, "interactionTarget");
    if (!idsEqual(announce.objectId, targetId)) {
      return {
        type: "objectMismatch",
        expected: targetId,
        actual: announce.objectId ?? undefined,
      };
    }
    if (
      !idsEqual(announce.actorId, request.actorId ?? new URL("about:blank"))
    ) {
      return {
        type: "requesterMismatch",
        expected: request.actorId ?? new URL("about:blank"),
        actual: announce.actorId ?? undefined,
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
      evidence: { type: "activity", activityType: Announce.typeId },
    }),
});
