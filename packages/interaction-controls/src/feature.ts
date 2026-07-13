import {
  type Actor,
  Application,
  FeatureAuthorization,
  FeaturedCollection,
  FeatureRequest,
  Group,
  isActor,
  type Object as ASObject,
  Organization,
  Person,
  Service,
} from "@fedify/vocab";
import { createInteractionControl, idsEqual } from "./control.ts";
import type { InteractionControl } from "./types.ts";

export const featureInteraction: InteractionControl<
  FeatureRequest,
  FeatureAuthorization,
  FeaturedCollection,
  Actor,
  ASObject
> = createInteractionControl({
  name: "feature",
  policyProperty: "canFeature",
  requestClass: FeatureRequest,
  authorizationClass: FeatureAuthorization,
  getInteractingObject: (request, options) =>
    request.getInstrument(options) as Promise<FeaturedCollection | null>,
  isInteractingObject: (object): object is FeaturedCollection =>
    object instanceof FeaturedCollection,
  interactingObjectTypes: [FeaturedCollection.typeId],
  getInteractionTarget: (request, options) =>
    request.getObject(options) as Promise<Actor | null>,
  isInteractionTarget: isActor,
  interactionTargetTypes: [
    Application.typeId,
    Group.typeId,
    Organization.typeId,
    Person.typeId,
    Service.typeId,
  ],
  getRequester: (_request, collection) => collection.attributionId,
  validateRequest: (_request, collection, _target, requester) => {
    if (!idsEqual(collection.attributionId, requester)) {
      return {
        type: "requesterMismatch",
        expected: requester,
        actual: collection.attributionId ?? undefined,
      };
    }
    return null;
  },
  authorizationAttribution: "optional",
  getSelfActor: (subject) => subject.id,
  defaultMissingPolicy: "denied",
  recognizeImpolite: () => null,
});
