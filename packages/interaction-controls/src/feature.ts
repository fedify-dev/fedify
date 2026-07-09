import {
  type Actor,
  FeatureAuthorization,
  type FeaturedCollection,
  FeatureRequest,
  type Object as ASObject,
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
  getInteractionTarget: (request, options) =>
    request.getObject(options) as Promise<Actor | null>,
  validateRequest: (request, collection) => {
    if (
      !idsEqual(
        collection.attributionId,
        request.actorId ?? new URL("about:blank"),
      )
    ) {
      return {
        type: "requesterMismatch",
        expected: request.actorId ?? new URL("about:blank"),
        actual: collection.attributionId ?? undefined,
      };
    }
    return null;
  },
  getSelfActor: (subject) => subject.id,
  defaultMissingPolicy: "denied",
  recognizeImpolite: () => null,
});
