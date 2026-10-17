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
import { createInteractionControl } from "./control.ts";
import { sameId } from "./evidence.ts";
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
  // Mastodon sends FeatureRequest activities without an actor, whose
  // requester is the authenticated owner of the collection, as the
  // collection's own document names it; a collection embedded in the request
  // is never trusted:
  authoritativeInteractingObject: true,
  validateRequest: (_request, collection, _target, requester) => {
    if (!sameId(collection.attributionId, requester)) {
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
